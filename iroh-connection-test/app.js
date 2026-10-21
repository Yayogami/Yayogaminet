import { PrivacyClient } from './transport.js';
const $ = id => document.getElementById(id);
let client;
let sendingSession;
function state(value) { $('state').textContent = value; }
function log(type, value) {
  $('diagnostics').textContent = `${new Date().toLocaleTimeString()} ${type}: ${value}\n` + $('diagnostics').textContent.slice(0, 8000);
}
function message(who, text, status = '') {
  document.querySelector('.empty')?.remove();
  const li = document.createElement('li'), label = document.createElement('small');
  label.textContent = `${who}${status ? ' · ' + status : ''}`;
  li.append(label, document.createTextNode(text));
  $('messages').append(li);
  while ($('messages').children.length > 100) $('messages').firstChild.remove();
  li.scrollIntoView({ block: 'nearest' });
  return label;
}
function lock(active) {
  $('create').disabled = $('join').disabled = active;
  $('stop').disabled = !active;
  $('consent').disabled = active;
  $('invite').readOnly = active;
}
function endSession({ force = false } = {}) {
  const ending = client;
  client = undefined;
  sendingSession = undefined;
  void ending?.close({ force });
  $('invite').value = $('message').value = '';
  $('consent').checked = false;
  $('messages').replaceChildren();
  $('diagnostics').textContent = $('error').textContent = '';
  $('send').disabled = $('message').disabled = true;
  lock(false); state('Ended');
}
async function start(join) {
  $('error').textContent = '';
  // Headerless hosting cannot enforce frame-ancestors through a meta policy.
  // Refuse session creation in any frame before allocating a transport worker.
  if (window.top !== window.self) {
    $('error').textContent = 'Open this page in its own tab to start a session.';
    $('consent').checked = false;
    return;
  }
  if (!$('consent').checked) { $('error').textContent = 'Please allow the network session first.'; return; }
  const invitation = join ? $('invite').value.trim() : undefined;
  if (join && !invitation) { $('error').textContent = 'Paste an invitation first.'; return; }
  const session = client = new PrivacyClient();
  let starting = true;
  session.addEventListener('event', ({ detail: { type, value } }) => {
    if (client !== session) return;
    if (type === 'message') { message('Peer', value); return; }
    log(type, value);
    if (type === 'connected') { state('Connected'); $('send').disabled = $('message').disabled = false; }
    if (type === 'disconnected' || (type === 'closed' && !starting)) {
      const deliveryUnknown = sendingSession === session;
      endSession();
      state('Disconnected — start a fresh session');
      if (deliveryUnknown) $('error').textContent = 'Delivery unknown: the peer may have received your message. It was not automatically resent.';
    }
  });
  lock(true); state('Connecting to relay…');
  try {
    const generated = await session.start(invitation);
    starting = false;
    if (client !== session) return;
    if (generated) { $('invite').value = generated; state('Ready — waiting for peer'); }
  } catch (error) {
    starting = false;
    if (client !== session) return;
    endSession();
    $('error').textContent = error.message;
    state('Failed — no fallback'); lock(false); $('consent').checked = false;
  }
}
$('create').onclick = () => start(false);
$('join').onclick = () => start(true);
$('stop').onclick = endSession;
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('invite').value); log('clipboard', 'Invitation copied'); }
  catch { $('error').textContent = 'Select and copy the invitation manually.'; }
};
$('send-form').onsubmit = async event => {
  event.preventDefault();
  const text = $('message').value;
  if (!text || !client) return;
  const session = client;
  sendingSession = session;
  $('send').disabled = true;
  const label = message('You', text, 'sending');
  try { await session.send(text); if (client !== session) return; label.textContent = 'You · acknowledged'; $('message').value = ''; }
  catch (error) { if (client !== session) return; label.textContent = 'You · delivery unknown'; $('error').textContent = error.message; }
  finally { if (sendingSession === session) sendingSession = undefined; $('send').disabled = client?.status.state !== 'connected'; }
};
window.addEventListener('pagehide', () => endSession({ force: true }));
