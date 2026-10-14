import { loadAssets } from './assets.js';
import { games } from './games.js';
import { setupRooms } from './room-ui.js';

const list = document.querySelector('#game-list');
const dialog = document.querySelector('#room-dialog');
let selectedGame = null;
let lastRoomButton = null;
let boardView = null;
let previewGeneration = 0;

try {
  const artwork = await loadAssets();
  artwork.apply(document.body, 'background');
  document.querySelectorAll('[data-art]').forEach(node => artwork.apply(node, node.dataset.art));

  for (const game of games) {
    const card = document.createElement('button');
    card.className = 'game-card art-surface';
    card.type = 'button';
    card.dataset.game = game.id;
    card.setAttribute('aria-pressed', 'false');
    artwork.apply(card, 'panel');

    const heading = document.createElement('h2');
    heading.textContent = game.name;
    const variant = document.createElement('p');
    variant.className = 'variant';
    variant.textContent = `${game.variant} · ${game.boardSize} × ${game.boardSize}`;
    const illustration = document.createElement('img');
    illustration.className = 'game-illustration';
    illustration.alt = '';
    illustration.draggable = false;
    artwork.apply(illustration, game.illustration);
    const detail = document.createElement('p');
    detail.className = 'game-detail';
    detail.textContent = game.detail;
    const selected = document.createElement('span');
    selected.className = 'selected-label';
    selected.textContent = 'Selected';
    selected.setAttribute('aria-hidden', 'true');
    card.append(heading, variant, illustration, detail, selected);
    card.addEventListener('click', () => {
      selectedGame = game;
      list.querySelectorAll('button').forEach(node => node.setAttribute('aria-pressed', String(node === card)));
      document.querySelector('#selection').textContent = `${game.name} · ${game.variant}`;
      document.querySelectorAll('[data-action]').forEach(node => { node.disabled = false; });
      document.querySelector('#preview-board').disabled = false;
    });
    list.append(card);
  }

  setupRooms(artwork, () => selectedGame);
  document.querySelectorAll('[data-action]').forEach(button => {
    button.addEventListener('click', () => {
      if (!selectedGame) return;
      lastRoomButton = button;
    });
  });
  document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => lastRoomButton?.focus());
  document.querySelector('#preview-board').addEventListener('click', async () => {
    if (!selectedGame) return;
    const generation = ++previewGeneration;
    document.querySelector('.menu').hidden = true;
    document.querySelector('#board-screen').hidden = false;
    window.scrollTo(0, 0);
    document.querySelector('#board-title').textContent = selectedGame.name;
    const status = document.querySelector('#board-status');
    status.textContent = 'Loading your board and pieces…';
    document.querySelector('#back-from-board').focus();
    try {
      const { createBoardView } = await import('./board-view.js');
      const loaded = await createBoardView(document.querySelector('#board-canvas'), selectedGame);
      if (generation !== previewGeneration) { loaded.dispose(); return; }
      boardView = loaded;
      status.textContent = `${selectedGame.boardSize} × ${selectedGame.boardSize} · 450 mm board · ${Math.round(loaded.layout.pieceScale * 100)}% piece scale`;
    } catch (error) {
      if (generation === previewGeneration) status.textContent = `Board could not load: ${error.message}`;
    }
  });
  document.querySelector('#back-from-board').addEventListener('click', () => {
    previewGeneration++;
    boardView?.dispose(); boardView = null;
    document.querySelector('#board-screen').hidden = true;
    document.querySelector('.menu').hidden = false;
    window.scrollTo(0, 0);
    document.querySelector('#preview-board').focus();
  });
} catch (error) {
  const alert = document.querySelector('#error');
  alert.textContent = error.message;
  alert.hidden = false;
}
