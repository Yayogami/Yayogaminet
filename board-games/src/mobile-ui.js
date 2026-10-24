// Phone/tablet presentation only. A narrow desktop window keeps the desktop UI.
(() => {
  const mobile = navigator.userAgentData?.mobile || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  if (!mobile) return;
  document.documentElement.classList.add('mobile-ui');
  document.addEventListener('DOMContentLoaded', () => {
    const find = id => document.getElementById(id), room = find('live-room');
    const make = (tag, className) => { const node = document.createElement(tag); node.className = className; return node; };
    const button = (text, id) => { const node = make('button', 'mobile-button'); node.type = 'button'; node.textContent = text; node.id = id; return node; };
    const options = make('dialog', 'mobile-options'); options.id = 'mobile-options';
    options.setAttribute('aria-labelledby', 'mobile-options-title');
    const heading = make('header', 'mobile-options-heading'), title = document.createElement('h2');
    title.id = 'mobile-options-title'; title.textContent = 'Match options';
    const close = button('Back to board', 'mobile-options-close'); heading.append(title, close); options.append(heading);
    const open = button('Options', 'mobile-options-open'); open.setAttribute('aria-haspopup', 'dialog'); open.setAttribute('aria-controls', options.id);
    room.querySelector('.board-toolbar').append(open);
    open.addEventListener('click', () => options.showModal()); close.addEventListener('click', () => options.close());
    options.addEventListener('close', () => { if (!room.hidden) open.focus(); });
    options.addEventListener('click', event => { const box = options.getBoundingClientRect(); if (event.target === options && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) options.close(); });

    const invite = make('section', 'mobile-invitation'); invite.setAttribute('aria-label', 'Invite another player');
    find('copy-invitation').textContent = 'Copy invite';
    invite.append(find('invitation-code').closest('label'), find('copy-invitation'));
    room.querySelector('.match-clock').after(invite);
    const panel = make('div', 'mobile-play-panel'), actions = make('nav', 'mobile-play-actions'); actions.setAttribute('aria-label', 'Board controls');
    actions.append(find('room-ready'), find('board-lock'), room.querySelector('.reaction-control'), find('extend-reconnect'));
    const moves = room.querySelector('.move-controls'), picker = make('details', 'mobile-piece-picker'), summary = document.createElement('summary');
    summary.textContent = 'Select a piece by number'; picker.append(summary, find('piece-picker').closest('label'));
    find('clear-move').textContent = 'Clear';
    const confirm = make('div', 'mobile-move-buttons'); confirm.append(find('confirm-move'), find('clear-move')); moves.append(confirm, picker);
    panel.append(actions, moves, find('pending-request')); find('live-canvas').after(panel);
    find('leave-room').addEventListener('click', () => options.close());
    options.append(find('seat-status'), room.querySelector('.match-actions'), room.querySelector('.room-rules-summary'), room.querySelector('.reaction-actions'), find('leave-room'));
    room.querySelector('.room-side-panel').remove(); document.body.append(options);

    const sync = () => {
      const title = find('live-title'), shortTitle = title.textContent.replace(' · You are ', ' · ');
      if (title.textContent !== shortTitle) title.textContent = shortTitle;
      room.dataset.mobileWaiting = String(!find('room-ready').hidden);
      invite.hidden = !find('invitation-code').value;
      if (room.hidden && options.open) options.close();
    };
    new MutationObserver(sync).observe(room.querySelector('.board-toolbar'), {childList: true, subtree: true});
    new MutationObserver(sync).observe(find('room-ready'), {attributes: true, attributeFilter: ['hidden']});
    new MutationObserver(sync).observe(room, {attributes: true, attributeFilter: ['hidden']});
    const touchCopy = () => {
      for (const id of ['move-instruction', 'board-lock']) {
        const node = find(id), text = node.textContent.replaceAll('double-click', 'double-tap').replace('Click a piece', 'Tap a piece').replace(' Board', '');
        if (node.textContent !== text) node.textContent = text;
      }
    };
    for (const id of ['move-instruction', 'board-lock']) new MutationObserver(touchCopy).observe(find(id), {childList: true});
    find('board-screen').querySelector('.board-help').textContent = 'Unlock the board to rotate or pinch to zoom. Return to games to play.';
    touchCopy();
    sync();
  }, {once: true});
})();
