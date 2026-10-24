import { createDefaultRoomRules } from './room-rules.js';
import { createRoom, joinRoom, readRoom, roomInvitation, connectRoom, rememberRoom, savedRoom, forgetRoom, cancelRoomConnection } from './room-client.js';
import { legalMoves } from './move-rules.js';
import { isEligibleClaim } from './draw-rules.js';
import { games } from './games.js';
import { REACTIONS, REACTION_DURATION_MS } from './reactions.js';
import { createGameAudio } from './game-audio.js';

const toggles = { touchMove: 'Touch-move', legalMoveHints: 'Legal-move highlights', resignation: 'Resignation', drawOffers: 'Draw offers', mutuallyAgreedTakebacks: 'Agreed takebacks', rematches: 'Rematches' };
const developmentNote = 'Encrypted relay connection · Keep both game tabs open. After a full disconnect, share a fresh invitation to resume.';
const number = (square, size) => square.row * size / 2 + Math.floor(square.column / 2) + 1;
const clockText = milliseconds => {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

export function setupRooms(artwork, getGame) {
  const dialog = document.querySelector('#room-dialog');
  // Cancel network startup through the existing Back/Escape controls.
  document.querySelector('#close-dialog').addEventListener('click',()=>{if(busy&&menu.hidden===false)cancelRoomConnection();});
  dialog.addEventListener('cancel',()=>{if(busy&&menu.hidden===false)cancelRoomConnection();});
  const content = document.querySelector('#room-content');
  const error = document.querySelector('#room-error');
  const screen = document.querySelector('#live-room');
  const menu = document.querySelector('.menu');
  let connection = null, current = null, view = null, generation = 0, selected = null, draft = null, lastPly = -1, busy = false, connectionError = false;
  let drawWithMove = false, lastPositionVersion = -1;
  const seenReactions=new Set(), reactionTimers=new Set();
  const sounds=createGameAudio();
  let countdownSound=null, countdownTimer=null;
  function animateCountdown(room) {
    clearTimeout(countdownTimer);
    const countdown=document.querySelector('#start-countdown');
    countdown.hidden=room.phase!=='waiting' || room.startAt==null;
    if(countdown.hidden){countdownSound=null;return;}
    const receivedAt=performance.now();
    function step() {
      const remaining=room.startAt-room.serverTime-(performance.now()-receivedAt);
      const seconds=Math.max(0,Math.ceil(remaining/1000));
      countdown.textContent=seconds?`Starting in ${seconds}`:'Go!';
      const key=`${room.matchNumber}:${room.startAt}:${seconds}`;
      if(seconds && countdownSound!==key){countdownSound=key;sounds.play('countdown');}
      if(seconds)countdownTimer=setTimeout(step,Math.max(20,remaining-(seconds-1)*1000+5));
    }
    step();
  }
  function showReactions(room) {
    for(const event of room.reactions || []) {
      if(seenReactions.has(event.id))continue;
      seenReactions.add(event.id);
      const reaction=REACTIONS.find(item=>item.id===event.reactionId);
      const remaining=REACTION_DURATION_MS-Math.max(0,room.serverTime-event.at);
      if(!reaction || !Number.isFinite(remaining) || remaining<=0)continue;
      const image=document.createElement('img');image.className='posted-reaction';image.alt=`${event.by==='blue'?'Blue':'White'}: ${reaction.label}`;
      artwork.apply(image,reaction.asset);document.querySelector('#reaction-stage').append(image);
      sounds.play('reaction');
      const timer=setTimeout(()=>{image.remove();reactionTimers.delete(timer);},remaining);reactionTimers.add(timer);
    }
    if(seenReactions.size>100) {const keep=[...seenReactions].slice(-30);seenReactions.clear();keep.forEach(id=>seenReactions.add(id));}
  }
  let joinedRoom = null, feedbackTimer = null;
  function joinFeedback() {
    const banner = document.querySelector('#join-feedback'); banner.hidden = false;
    clearTimeout(feedbackTimer); feedbackTimer = setTimeout(()=>{banner.hidden=true;},2500);
  }
  function lockChanged(locked) {
    const control=document.querySelector('#board-lock'); control.textContent=locked?'Unlock Board':'Lock Board'; control.setAttribute('aria-pressed',String(locked));
  }
  const paint = root => root.querySelectorAll('[data-art]').forEach(node => artwork.apply(node, node.dataset.art));
  const button = (label, handler) => {
    const node = document.createElement('button'); node.type = 'button'; node.className = 'art-button';
    node.textContent = label; artwork.apply(node, 'button'); node.addEventListener('click', handler); return node;
  };
  const showError = message => { error.textContent = message; error.hidden = !message; };
  async function run(work) {
    if (busy) return;
    busy = true; showError(''); document.querySelector('#room-session-status').textContent = '';
    document.querySelector('#room-progress').textContent = 'Working…';
    try { await work(); } catch (e) { showError(e.message); document.querySelector('#live-message').textContent = e.message; if (!menu.hidden && !dialog.open) document.querySelector('#room-session-status').textContent = e.message; }
    finally { busy = false; document.querySelector('#room-progress').textContent = ''; }
  }
  function moveChoices() { return current ? legalMoves(current.position).filter(move => move.pieceId === selected) : []; }
  function updateActions() {
    if (!current) return;
    const playing = current.phase === 'playing', ownTurn = current.position.turn === current.you;
    document.querySelector('#confirm-move').classList.toggle('your-turn-glow',playing&&ownTurn);
    document.querySelector('.turn-alert').classList.toggle('turn-active',playing);
    const claim = document.querySelector('#claim-draw');
    const claimable = current.draws && (current.draws.reasons.length || (ownTurn && draft && isEligibleClaim(current.draws,draft)));
    claim.disabled = !playing || !claimable;
    document.querySelector('#draw-eligibility').textContent = current.draws?.reasons.map(reason=>reason.label).join(' ') || (claimable ? 'Your selected move would create the third occurrence of a position. You may claim before playing it.' : '');
    const offer = document.querySelector('#offer-draw');
    offer.hidden = !current.rules.drawOffers || current.gameId !== 'american-checkers';
    offer.disabled = !playing || !!current.pending;
    const attached = document.querySelector('#draw-with-move');
    attached.hidden = !current.rules.drawOffers || current.gameId !== 'international-draughts';
    attached.disabled = !playing || !ownTurn || current.position.ply + 1 < current.rules.draughtsDrawOfferMinimumMoves * 2 || !!current.pending;
    attached.setAttribute('aria-pressed',String(drawWithMove));
    attached.textContent = drawWithMove ? 'Draw offer with move: On' : 'Offer draw with this move';
    attached.title = 'Available once both players have completed 40 moves.';
    const takeback = document.querySelector('#request-takeback');
    takeback.hidden = !current.rules.mutuallyAgreedTakebacks; takeback.disabled = !playing || !current.position.ply || !!current.pending;
    const rematch = document.querySelector('#request-rematch');
    rematch.hidden = !current.rules.rematches || current.phase !== 'finished'; rematch.disabled = !!current.pending;
    const pending=current.pending, canRespond=pending && pending.by!==current.you;
    document.querySelector('#pending-request').hidden = !pending;
    document.querySelector('#pending-request-text').textContent = pending ? `${pending.by===current.you?'You':pending.by==='blue'?'Blue':'White'} requested ${pending.type==='draw'?'a draw':pending.type==='takeback'?'a takeback of the last move':'a rematch with sides swapped'}. ${pending.by===current.you?'Waiting for your opponent.':''}` : '';
    for(const id of ['accept-request','decline-request']) {
      const control=document.querySelector(`#${id}`);control.hidden=!canRespond;control.disabled=current.phase==='paused';
    }
  }
  function renderChoices(candidates = null) {
    view?.setSelected(selected);
    const tray = document.querySelector('#move-routes'); tray.replaceChildren();
    const canMove = current?.phase === 'playing' && current.position.turn === current.you;
    const picker = document.querySelector('#piece-picker');
    picker.replaceChildren(new Option('Choose a piece', ''));
    if (current) for (const piece of current.position.pieces.filter(p=>p.side===current.you)) picker.add(new Option(`Square ${number(piece, games.find(g=>g.id===current.gameId).boardSize)}${piece.king?' · King':''}`,piece.id));
    picker.value = selected || ''; picker.disabled = !canMove;
    const choices = canMove ? (candidates || moveChoices()) : [];
    if (current?.rules.legalMoveHints && canMove) {
      const squares = [...new Map(moveChoices().map(move => { const end=move.route.at(-1); return [`${end.row},${end.column}`,end]; })).values()];
      view?.showHints(squares);
    } else view?.showHints([]);
    if (candidates || current?.rules.legalMoveHints) for (const move of choices) {
      const text = move.route.map(s => number(s, games.find(g=>g.id===current.gameId).boardSize)).join(' → ');
      const choice = button(`${move.captures.length ? 'Capture' : 'Move'}: ${text}`, () => { draft = move; renderChoices(candidates); });
      choice.setAttribute('aria-pressed', String(draft === move || JSON.stringify(draft) === JSON.stringify(move)));
      tray.append(choice);
    }
    document.querySelector('#confirm-move').disabled = !canMove || !draft;
    document.querySelector('#clear-move').disabled = !selected;
    document.querySelector('#move-instruction').textContent = !canMove ? 'Waiting for your turn.' : draft
      ? `Selected route: ${draft.route.map(s=>number(s,games.find(g=>g.id===current.gameId).boardSize)).join(' → ')}. Confirm to play.`
      : selected ? 'Choose a destination on the board, then select the complete route.' : 'Click a piece, then its destination.';
    updateActions();
  }
  async function squareClicked(square) {
    if (!current || current.phase !== 'playing' || current.position.turn !== current.you || busy) return;
    const piece = current.position.pieces.find(p => p.row === square.row && p.column === square.column && p.side === current.you);
    if (piece && legalMoves(current.position).some(move => move.pieceId === piece.id)) {
      if (current.rules.touchMove && current.selectedPiece && current.selectedPiece !== piece.id) return;
      await run(async () => {
        if (current.rules.touchMove) await connection.action({ type:'select', ply:current.position.ply, pieceId:piece.id });
        selected = piece.id; draft = null; renderChoices();
      });
    } else if (selected) {
      const candidates = moveChoices().filter(move => { const end=move.route.at(-1); return end.row===square.row && end.column===square.column; });
      if (candidates.length) { draft = candidates.length === 1 ? candidates[0] : null; renderChoices(candidates); }
    }
  }
  function receive(room) {
    if (current && !current.networkIssue && !room.networkIssue && (room.revision < current.revision || (room.revision === current.revision && room.serverTime < current.serverTime))) return;
    const previousPhase = current?.phase;
    const previousMatch = current?.matchNumber, previousSide = current?.you;
    if(current) {
      for(const player of room.players) {
        if(player.side===room.you)continue;
        const old=current.players.find(p=>p.side===player.side);
        if(player.connected && (!old || !old.connected))sounds.play('join');
        else if(!player.connected && old?.connected)sounds.play('leave');
      }
      if(room.matchNumber===current.matchNumber && room.position.ply>current.position.ply)sounds.play('turn');
      if(room.startAt!=null && room.startAt!==current.startAt)sounds.play('ready');
    } else sounds.play('join');
    current = room;
    showReactions(room);
    if (room.players.length === 2 && room.players.every(p=>p.connected) && joinedRoom !== room.id) { joinedRoom=room.id; joinFeedback(); }
    animateCountdown(room);
    if (connectionError) { connectionError = false; document.querySelector('#live-message').textContent = developmentNote; }
    const game = games.find(g=>g.id===room.gameId);
    document.querySelector('#live-title').textContent = `${game.name} · You are ${room.you === 'blue' ? 'Blue' : 'White'}`;
    document.querySelector('#invitation-code').value = roomInvitation(savedRoom());
    document.querySelector('#live-rules').textContent = [room.rules.visibility === 'public' ? 'Public room' : 'Private room',
      ...Object.entries(toggles).map(([key,label])=>`${label}: ${room.rules[key]?'on':'off'}`),
      room.rules.clock.enabled ? `${room.rules.clock.initialSeconds / 60} minutes + ${room.rules.clock.incrementSeconds} seconds per move` : 'Clock off',
      room.rules.disconnect.mode === 'reconnect' ? 'Reconnect: five minutes, clocks paused; connected player may add five minutes repeatedly' : 'Disconnection ends without result',
      'Complete capture route and Confirm Move required'].join(' · ');
    document.querySelector('#seat-status').textContent = ['blue','white'].map(side => {
      const seat = room.players.find(p=>p.side===side);
      return `${side === 'blue' ? 'Blue' : 'White'}: ${!seat ? 'waiting for a player' : !seat.connected ? 'disconnected' : room.phase !== 'waiting' ? 'connected' : seat.ready ? 'ready' : 'not ready'}`;
    }).join(' · ');
    const ready = document.querySelector('#room-ready');
    ready.hidden = room.phase !== 'waiting'; ready.textContent = room.players.find(p=>p.side===room.you)?.ready ? 'Not Ready' : 'Ready';
    document.querySelector('#extend-reconnect').hidden = room.phase !== 'paused' || room.recovering;
    document.querySelector('#resign-match').hidden = !room.rules.resignation || !['playing','paused'].includes(room.phase);
    document.querySelector('#live-clocks').textContent = room.rules.clock.enabled ? `Blue ${clockText(room.clocks.blue)} · White ${clockText(room.clocks.white)}` : 'No clock';
    document.querySelector('#live-state').textContent = room.phase === 'waiting' ? room.startAt!=null ? 'Get ready — clocks start after the countdown.' : 'Both players must click Ready.'
      : room.phase === 'playing' ? `${room.position.turn === 'blue' ? 'Blue' : 'White'} to move`
      : room.phase === 'paused' ? room.recovering ? 'Room restored · clocks paused until both players return.' : `Connection lost · clocks paused · ${clockText(room.reconnectDeadline - room.serverTime)} to reconnect`
      : room.result?.draw ? `Draw · ${room.result.reason==='agreed-draw'?'agreed by both players':'valid rule claim'}`
      : room.result?.winner ? `${room.result.winner === 'blue' ? 'Blue' : 'White'} wins (${room.result.reason}).` : `Match ended without result (${room.result?.reason}).`;
    if (room.positionVersion !== lastPositionVersion || previousMatch !== room.matchNumber) {
      lastPly = room.position.ply; lastPositionVersion = room.positionVersion; selected = null; draft = null; drawWithMove = false;
      view?.setPieces(room.position.pieces);
      if (previousSide && previousSide !== room.you) view?.setSide(room.you);
      renderChoices();
    } else if (previousPhase !== room.phase) renderChoices();
    if (room.selectedPiece && room.you === room.position.turn && selected !== room.selectedPiece) { selected=room.selectedPiece; renderChoices(); }
    updateActions();
  }
  async function enter(session, initial = null) {
    let first = initial;
    if (!first) {
      try { first = await readRoom(session); }
      catch (error) {
        if ([401,404].includes(error.status)) { forgetRoom(); document.querySelector('#resume-room').hidden = true; error.message = 'That room is no longer available. Create or join another room.'; }
        throw error;
      }
    }
    connection?.stop(); view?.dispose(); view=null; current=null; lastPly=-1; lastPositionVersion=-1; selected=null; draft=null;
    const ownGeneration=++generation;
    rememberRoom(session); dialog.close(); menu.hidden=true; screen.hidden=false; window.scrollTo(0,0);
    document.querySelector('#live-message').textContent='Loading room and board…';
    receive(first);
    connection=connectRoom(session,receive,e=> { connectionError = true; document.querySelector('#live-message').textContent=`Connection interrupted: ${e.message}. Retrying…`; },first);
    const { createBoardView }=await import('./board-view.js');
    const loaded=await createBoardView(document.querySelector('#live-canvas'),games.find(g=>g.id===first.gameId),{side:first.you,onSquare:squareClicked,onLockChange:lockChanged,artwork});
    if (ownGeneration!==generation) { loaded.dispose(); return; }
    view=loaded; view.setPieces(current.position.pieces); view.setSide(current.you); renderChoices();
    document.querySelector('#live-message').textContent=developmentNote;
  }
  function open(action) {
    const game=getGame(); if(!game)return;
    showError(''); content.replaceChildren();
    document.querySelector('#dialog-title').textContent=`${action==='create'?'Create a Room':action==='public'?'Public Rooms':'Join a Private Room'} · ${game.name}`;
    document.querySelector('#dialog-copy').textContent=action==='create'?'Choose your rules. Both players must be ready before play begins.':'';
    if(action==='create') {
      const defaults=createDefaultRoomRules();
      const form=document.createElement('form'); form.className='room-form';
      form.innerHTML=`<label>Your side<select name="creatorSide" required><option value="">Choose a side</option><option value="blue">Blue</option><option value="white">White</option></select></label>
        <p>Invitation-only room · The creator manages the clock; both players validate moves.</p>
        <div class="rule-toggles"></div>
        <label>Clock<select name="clock"><option value="off">Off</option><option value="on">On</option></select></label>
        <label>Starting minutes<input name="minutes" type="number" min="1" step="1" value="80" required></label>
        <label>Increment seconds<input name="increment" type="number" min="0" step="15" value="30" required></label>
        <label>Disconnection<select name="disconnect"><option value="reconnect">Allow reconnect (5 minutes)</option><option value="end-without-result">End without result</option></select></label>`;
      for(const [name,label]of Object.entries(toggles)) {
        const toggle=button(`${label}: ${defaults[name]?'On':'Off'}`,()=>{defaults[name]=!defaults[name];toggle.textContent=`${label}: ${defaults[name]?'On':'Off'}`;toggle.setAttribute('aria-pressed',String(defaults[name]));});
        toggle.setAttribute('aria-pressed',String(defaults[name])); form.querySelector('.rule-toggles').append(toggle);
      }
      const submit=button('Create Room',()=>{}); submit.type='submit'; form.append(submit);
      form.addEventListener('submit',event=>{event.preventDefault();run(async()=>{
        const values=new FormData(form); defaults.creatorSide=values.get('creatorSide'); defaults.visibility='private';
        defaults.clock.enabled=values.get('clock')==='on'; defaults.clock.initialSeconds=Number(values.get('minutes'))*60; defaults.clock.incrementSeconds=Number(values.get('increment')); defaults.disconnect.mode=values.get('disconnect');
        const result=await createRoom({gameId:game.id,rules:defaults});
        await enter(result.session,result.room);
      });}); content.append(form);
    } else if(action==='private') {
      const form=document.createElement('form');form.className='room-form';
      form.innerHTML='<label>Invitation code<input name="code" required autocomplete="off" spellcheck="false"></label>';
      const join=button('Join Room',()=>{});join.type='submit';form.append(join);
      form.addEventListener('submit',event=>{event.preventDefault();run(async()=>{
        const result=await joinRoom(new FormData(form).get('code'));
        await enter(result.session,result.room);
      });});content.append(form);
    }
    paint(content); dialog.showModal();
  }
  document.querySelectorAll('[data-action]').forEach(node=>node.addEventListener('click',()=>open(node.dataset.action)));
  document.querySelector('#room-ready').addEventListener('click',()=>run(()=>connection.action({type:'ready',ready:!current.players.find(p=>p.side===current.you).ready})));
  const reactionPicker=document.querySelector('#reaction-picker'), reactionToggle=document.querySelector('#reactions-toggle');
  function closeReactions(){reactionPicker.hidden=true;reactionToggle.setAttribute('aria-expanded','false');}
  reactionToggle.addEventListener('click',()=>{reactionPicker.hidden=!reactionPicker.hidden;reactionToggle.setAttribute('aria-expanded',String(!reactionPicker.hidden));});
  for(const reaction of REACTIONS) {
    const control=button(reaction.label,()=>run(async()=>{await connection.action({type:'reaction',reactionId:reaction.id});closeReactions();}));
    control.setAttribute('aria-label',reaction.label);
    const image=document.createElement('img');image.alt='';artwork.apply(image,reaction.asset);control.prepend(image);reactionPicker.append(control);
  }
  reactionPicker.addEventListener('keydown',event=>{if(event.key==='Escape'){closeReactions();reactionToggle.focus();}});
  document.querySelector('#board-lock').addEventListener('click',()=>{if(view)view.setLocked(!view.isLocked());});
  document.querySelector('#copy-invitation').addEventListener('click',()=>run(async()=>{
    let url=new URL(window.location.href);
    try { if(window.parent!==window)url=new URL(window.parent.location.href); } catch {}
    const invitation=roomInvitation(savedRoom());if(!invitation)throw new Error('This invitation is already in use. A fresh code appears after disconnecting.');
    url.hash=new URLSearchParams({join:invitation}).toString();
    await navigator.clipboard.writeText(url.href);
    document.querySelector('#live-message').textContent='Invitation link copied. You will approve the joining player.';
  }));
  document.querySelector('#extend-reconnect').addEventListener('click',()=>run(()=>connection.action({type:'extend'})));
  document.querySelector('#resign-match').addEventListener('click',()=>run(()=>connection.action({type:'resign'})));
  document.querySelector('#confirm-move').addEventListener('click',()=>run(async()=>{
    if(draft)await connection.action({type:'move',ply:current.position.ply,pieceId:draft.pieceId,route:draft.route,offerDraw:drawWithMove});
  }));
  document.querySelector('#draw-with-move').addEventListener('click',()=>{drawWithMove=!drawWithMove;updateActions();});
  document.querySelector('#claim-draw').addEventListener('click',()=>run(()=>connection.action({type:'claim-draw',ply:current.position.ply,pieceId:draft?.pieceId,route:draft?.route})));
  for(const type of ['offer-draw','request-takeback','request-rematch']) document.querySelector(`#${type}`).addEventListener('click',()=>run(()=>connection.action({type,ply:current.position.ply})));
  for(const [id,accept] of [['accept-request',true],['decline-request',false]]) document.querySelector(`#${id}`).addEventListener('click',()=>run(()=>connection.action({type:'respond',requestId:current.pending?.id,accept})));
  document.querySelector('#piece-picker').addEventListener('change',event=>{
    const piece=current?.position.pieces.find(p=>p.id===event.target.value);
    if(piece)squareClicked(piece);
  });
  document.querySelector('#clear-move').addEventListener('click',()=>{draft=null;if(!current?.rules.touchMove)selected=null;renderChoices();});
  document.querySelector('#leave-room').addEventListener('click',async()=>{
    sounds.play('leave');
    try {if(connection && !current?.networkIssue)await connection.action({type:'leave'});} catch {}
    clearTimeout(countdownTimer);
    closeReactions();for(const timer of reactionTimers)clearTimeout(timer);reactionTimers.clear();seenReactions.clear();document.querySelector('#reaction-stage').replaceChildren();
    generation++;connection?.stop();connection=null;view?.dispose();view=null;screen.hidden=true;menu.hidden=false;
    document.querySelector('#resume-room').hidden=false;window.scrollTo(0,0);
  });
  const resume=document.querySelector('#resume-room');resume.hidden=!savedRoom();
  resume.addEventListener('click',()=>run(()=>enter(savedRoom())));
  paint(screen);
  const invitationFromLink=new URLSearchParams(window.location.hash.slice(1)).get('join');
  if(invitationFromLink)run(async()=>{
    document.querySelector('#room-session-status').textContent='Joining your invitation…';
    const result=await joinRoom(invitationFromLink);
    await enter(result.session,result.room);
    history.replaceState(null,'',window.location.pathname+window.location.search);
  });
}
