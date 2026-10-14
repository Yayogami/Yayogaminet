import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createBoardLayout, initialPieces } from './board-layout.js';

/** Presentation only: future rules supply piece states; models never decide legal moves. */
export async function createBoardView(container, game, options = {}) {
  const manifestUrl = new URL('../public/models.json', import.meta.url);
  const response = await fetch(manifestUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error('Cannot load model manifest.');
  const config = await response.json();
  const asset = config.games[game.id];
  if (config.version !== 1 || !asset) throw new Error('Unsupported model configuration.');
  const url = path => new URL(path, manifestUrl).href;
  const loader = new GLTFLoader();
  const [board, blue, white, ground] = await Promise.all([
    loader.loadAsync(url(asset.board)), loader.loadAsync(url(config.pieces.blue)),
    loader.loadAsync(url(config.pieces.white)), new THREE.TextureLoader().loadAsync(url(asset.texture)),
  ]);
  ground.colorSpace = THREE.SRGBColorSpace;
  ground.flipY = false;
  ground.magFilter = THREE.NearestFilter;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffee, 0x526b3d, 1.2));
  const light = new THREE.DirectionalLight(0xfff4df, 1.3);
  light.position.set(-0.4, 0.8, 0.4);
  scene.add(light);
  board.scene.position.set(-config.surface.boardWidth / 2, 0, config.surface.boardDepth / 2);
  board.scene.traverse(obj => {
    if (!obj.isMesh) return;
    for (const material of Array.isArray(obj.material) ? obj.material : [obj.material]) {
      if (material.name === config.groundMaterial) { material.map = ground; material.needsUpdate = true; }
    }
  });
  scene.add(board.scene);
  const layout = createBoardLayout(game.boardSize, config.surface, config.pieces);
  const piecesGroup = new THREE.Group();
  scene.add(piecesGroup);
  const templates = { blue: blue.scene, white: white.scene };
  function setPieces(pieces) {
    piecesGroup.clear();
    for (const piece of pieces) {
      for (let level = 0; level < (piece.king ? 2 : 1); level++) {
        const model = templates[piece.side].clone(true);
        model.scale.setScalar(layout.pieceScale);
        const position = layout.center(piece.row, piece.column, level);
        model.position.set(position.x, position.y, position.z);
        model.userData.pieceId = piece.id;
        piecesGroup.add(model);
      }
    }
  }
  setPieces(initialPieces(game));
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  container.append(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', `${game.name} board, ${game.boardSize} by ${game.boardSize}, ${initialPieces(game).length} pieces. Drag to rotate; scroll to zoom.`);
  renderer.domElement.setAttribute('role', 'img');
  const camera = new THREE.PerspectiveCamera(38, 1, 0.005, 10);
  camera.position.set(0, 0.63, 0.44);
  const bottomSide = game.id === 'american-checkers' ? 'blue' : 'white';
  if (options.side && options.side !== bottomSide) camera.position.z *= -1;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.01, 0);
  controls.enablePan = false;
  controls.minDistance = 0.4;
  controls.maxDistance = 2;
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.update();
  const raycaster = new THREE.Raycaster();
  const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -config.surface.height);
  let down = null;
  const pointerDown = event => { down = { x: event.clientX, y: event.clientY }; };
  const pointerUp = event => {
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
    down = null;
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), camera);
    const point = raycaster.ray.intersectPlane(boardPlane, new THREE.Vector3());
    const square = point && layout.squareAt(point.x, point.z);
    if (square) options.onSquare?.(square);
  };
  renderer.domElement.addEventListener('pointerdown', pointerDown);
  renderer.domElement.addEventListener('pointerup', pointerUp);
  const markers = [];
  function showHints(squares = []) {
    for (const marker of markers) marker.element.remove();
    markers.length = 0;
    for (const square of squares) {
      const element = document.createElement('span');
      element.className = 'square-hint art-surface';
      element.textContent = String(square.row * game.boardSize / 2 + Math.floor(square.column / 2) + 1);
      element.setAttribute('aria-hidden', 'true');
      options.artwork?.apply(element, 'button');
      element.style.borderImageWidth = '6px';
      container.append(element);
      const center = layout.center(square.row, square.column);
      markers.push({ element, point: new THREE.Vector3(center.x, center.y + 0.002, center.z) });
    }
  }
  const mixer = new THREE.AnimationMixer(board.scene);
  if (asset.vegetation) for (const clip of board.animations) mixer.clipAction(clip).play();
  function resize() {
    const width = Math.max(container.clientWidth, 1), height = Math.max(container.clientHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.position.sub(controls.target).setLength(0.82 / Math.min(1, camera.aspect)).add(controls.target);
    camera.updateProjectionMatrix();
    controls.update();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  let lastTime = performance.now();
  renderer.setAnimationLoop(time => {
    mixer.update(Math.min((time - lastTime) / 1000, 0.1));
    lastTime = time;
    renderer.render(scene, camera);
    for (const marker of markers) {
      const projected = marker.point.clone().project(camera);
      marker.element.style.left = `${(projected.x + 1) / 2 * container.clientWidth}px`;
      marker.element.style.top = `${(1 - projected.y) / 2 * container.clientHeight}px`;
    }
  });
  return { layout, setPieces, showHints,
    setSide(side) {
      camera.position.set(0, 0.63, side === bottomSide ? 0.44 : -0.44);
      controls.target.set(0, 0.01, 0); resize();
    },
    dispose() {
      renderer.setAnimationLoop(null); observer.disconnect(); controls.dispose(); mixer.stopAllAction();
      showHints(); renderer.domElement.removeEventListener('pointerdown', pointerDown); renderer.domElement.removeEventListener('pointerup', pointerUp);
      const geometries = new Set(), materials = new Set(), textures = new Set([ground]);
      for (const root of [board.scene, blue.scene, white.scene]) root.traverse(obj => {
        if (obj.geometry) geometries.add(obj.geometry);
        for (const material of obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : []) {
          materials.add(material);
          for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        }
      });
      geometries.forEach(x => x.dispose()); materials.forEach(x => x.dispose()); textures.forEach(x => x.dispose());
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}
