import * as THREE from 'three';
import { createMatLayer } from './mat.js';
import { createToyWorld } from './toys.js';
import { createRng, randomSeed } from './rng.js';
import { buildDog, DOG_DEFAULTS } from './dogBuilder.js';
import { createCodexHandoff } from './codexHandoff.js';
import { hatchUniforms } from './hatch.js';
import {
  DOG_COATS,
  DOG_EYE_COLORS,
  DOG_POSES,
  DOG_EAR_TYPES,
  DOG_EAR_TIPS,
} from './dogCoats.js';
import {
  beginGrab,
  endGrab,
  pokeOffsetAt,
  pokeUniforms,
  pulsePoke,
  setGrabPoint,
  setGrabTarget,
  updatePokes,
} from './softPoke.js';

// 每一档都真的重新生成整只狗的网格，所以区间可以开得很大：
// 矮脚腊肠、大头奶狗、长嘴牧羊犬都在射程内。
const BODY_SLIDERS = [
  { key: 'headSize', name: '头身比', min: 0.4, max: 2.4, step: 0.01 },
  { key: 'chubbiness', name: '圆润度', min: 0.35, max: 3.2, step: 0.01 },
  { key: 'legLength', name: '腿长', min: 0.08, max: 2.6, step: 0.01 },
  { key: 'torsoLength', name: '躯干长度', min: 0.5, max: 2, step: 0.01 },
  { key: 'muzzleLength', name: '吻部长度', min: 0.22, max: 2.4, step: 0.01 },
  { key: 'earSize', name: '耳朵大小', min: 0.15, max: 2.8, step: 0.01 },
  { key: 'tailLength', name: '尾巴长度', min: 0.1, max: 2.8, step: 0.01 },
  { key: 'tailCurl', name: '尾巴卷曲', min: -0.55, max: 1.6, step: 0.01 },
];

const FACE_SLIDERS = [
  { key: 'eyeSize', name: '眼睛大小', min: 0.6, max: 1.8, step: 0.01 },
  { key: 'irisScale', name: '瞳孔大小', min: 0.12, max: 1.2, step: 0.01 },
];

const FUR_SLIDERS = [
  { key: 'furFluff', name: '炸毛程度', min: 0.15, max: 3, step: 0.01 },
];

// 随机遇见的小狗用一套更收敛的区间，保证每一只都还是好看的狗，
// 极端造型留给手动拖滑杆。
const RANDOM_RANGES = {
  headSize: [0.86, 1.34],
  chubbiness: [0.78, 1.55],
  legLength: [0.6, 1.5],
  torsoLength: [0.82, 1.28],
  muzzleLength: [0.65, 1.5],
  earSize: [0.7, 1.42],
  tailLength: [0.68, 1.45],
  tailCurl: [-0.2, 1.35],
  eyeSize: [0.92, 1.32],
  irisScale: [0.42, 0.86],
  furFluff: [0.4, 1.6],
};

const params = {
  ...DOG_DEFAULTS,
  seed: randomSeed(),
};

const state = {
  directionDegrees: 45,
  idlePlaying: true,
  lastTime: performance.now(),
  matSeed: randomSeed(),
  toySeed: randomSeed(),
  matVisible: true,
  toysVisible: true,
  clock: 0,
};

const canvas = document.getElementById('dog-canvas');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 30);
camera.position.set(0, 2.02, 5.4);

scene.add(new THREE.HemisphereLight('#fff8e8', '#819087', 2.7));

const keyLight = new THREE.DirectionalLight('#fff0d7', 3.2);
keyLight.position.set(3.2, 5.5, 4.2);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -4.5;
keyLight.shadow.camera.right = 4.5;
keyLight.shadow.camera.top = 5;
keyLight.shadow.camera.bottom = -2;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight('#b7d9d1', 1.3);
fillLight.position.set(-4.2, 2.8, -3.6);
scene.add(fillLight);

// 暗面排线用的是自己的一份主光方向。不同步的话，明暗交界会落在正对镜头的
// 那一面上，脸中间就会横过一道莫名其妙的深色带。
hatchUniforms.uKeyDir.value.copy(keyLight.position).normalize();
// 浅色花色多，排线浓度高了会在白底上读成布纹，所以压低一档。
hatchUniforms.uBodyHatch.value = 0.16;
hatchUniforms.uShadeAlpha.value = 0.4;

// 揉捏的影响半径要配合体型。半径太小的话，挤出环正好落在距离胸口
// 一个头长的地方——揉肚子会把整张脸顶成一个球。
pokeUniforms.uPokeRadius.value = 0.58;

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(10, 96),
  new THREE.MeshToonMaterial({ color: '#e9e2d2' })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.025;
floor.receiveShadow = true;
scene.add(floor);

const matLayer = createMatLayer(scene);
const toyWorld = createToyWorld(scene);
const MAT_DISPLAY_SCALE = 0.76;
matLayer.mesh.parent.scale.setScalar(MAT_DISPLAY_SCALE);

const dogRoot = new THREE.Group();
dogRoot.name = 'dogCharacter';
scene.add(dogRoot);

let dog = null;
let dogHeight = 1.4;
const dogSize = new THREE.Vector3(1.2, 1.4, 1.6);
let toyDrag = null;
let bodyDrag = null;
let fullQualityTimer = 0;
let pendingRebuild = false;

function setModelStatus(text, status = 'ready') {
  const element = document.getElementById('model-status');
  element.textContent = text;
  element.dataset.state = status;
}

function disposeDog() {
  if (!dog) return;
  dogRoot.remove(dog);
  dog.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      material.map?.dispose();
      material.dispose();
    }
  });
  dog = null;
}

function dogColliders() {
  if (!dog) return [];
  return dog.userData.colliders.map((collider) => ({
    c: collider.c.clone(),
    r: collider.r,
  }));
}

function rebuild(quality = 'full') {
  const built = buildDog(params, quality);
  disposeDog();
  dog = built;
  dogRoot.add(dog);
  // 取景要用小狗自身坐标系里的尺寸。setFromObject 给的是世界包围盒，
  // 转到侧面时 X/Z 会互换，镜头就会突然把长边裁掉。
  const { min, max } = dog.userData.bounds;
  dogSize.set(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  dogHeight = Math.max(max[1], 0.4);
  dogRoot.rotation.y = THREE.MathUtils.degToRad(state.directionDegrees);
  toyWorld.setCharacterColliders(dogColliders());
  toyWorld.setCharacterTransform(0, 0, dogRoot.rotation.y);
  matLayer.fitToCharacter(dogRoot);
  syncCamera();
  document.body.dataset.modelReady = 'true';
}

// 拖滑杆时先出一版粗网格保证跟手，停手 180ms 后再补一版细网格。
// draft → full 两段式，兼顾跟手和成品精度。
function rebuildDraftThenFull() {
  rebuild('draft');
  window.clearTimeout(fullQualityTimer);
  fullQualityTimer = window.setTimeout(() => rebuild('full'), 180);
}

function scheduleRebuild() {
  if (pendingRebuild) return;
  pendingRebuild = true;
  requestAnimationFrame(() => {
    pendingRebuild = false;
    rebuildDraftThenFull();
  });
}

function displayedMatBounds() {
  const bounds = matLayer.getBounds();
  return {
    width: bounds.width * MAT_DISPLAY_SCALE,
    depth: bounds.depth * MAT_DISPLAY_SCALE,
    centerX: bounds.centerX * MAT_DISPLAY_SCALE,
    centerZ: bounds.centerZ * MAT_DISPLAY_SCALE,
  };
}

function scatterToys(seed = state.toySeed) {
  state.toySeed = seed;
  toyWorld.scatterAroundMat(displayedMatBounds(), seed);
  // 玩具是配角：即使抽到彩蛋尺寸也不许挡住小狗的轮廓。
  for (const toy of toyWorld.toys) {
    const upper = toy.kind === 'dogBed' ? 0.82 : 0.96;
    toyWorld.setToyScale(toy, THREE.MathUtils.clamp(toy.scale, 0.6, upper));
  }
}

function randomizeMat(seed = randomSeed()) {
  state.matSeed = seed;
  matLayer.setSeed(seed);
  if (dog) matLayer.fitToCharacter(dogRoot);
}

// 固定的俯角；镜头只沿这条视线前后移动，让画面里的透视关系永远一致。
const VIEW_DIRECTION = new THREE.Vector3(0, 1.32, 5.4).normalize();

function syncCamera() {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const aspect = width / height;
  const sideAmount = Math.abs(Math.sin(THREE.MathUtils.degToRad(state.directionDegrees)));
  // 正面看时最宽的是身体宽度，侧面看时是躯干加尾巴；取景框按当前转角
  // 在两者之间插值，再和高度取较大值，任何极端体型都不会被裁掉。
  // 留白按比例给，不给固定值：趴着的小狗只有站着的一半高，
  // 固定留白会让它在画面里缩成很小一团。
  const horizontal = THREE.MathUtils.lerp(dogSize.x, dogSize.z, sideAmount) * 1.42;
  // 镜头是俯视的，躯干的进深会投影到画面的竖直方向上，所以竖直取景框
  // 还要把 Z 向尺寸按俯角分量算进去，否则趴着的小狗尾巴会顶出画面。
  const verticalSpan = Math.max(
    (dogSize.y + dogSize.z * 0.24) * 1.32 + 0.16,
    horizontal / Math.max(aspect, 0.55)
  );
  const centerY = dogHeight * 0.5;

  camera.left = -verticalSpan * aspect * 0.5;
  camera.right = verticalSpan * aspect * 0.5;
  camera.top = verticalSpan * 0.5;
  camera.bottom = -verticalSpan * 0.5;
  // 正交相机的 top/bottom 是相机自身坐标系里的偏移，不是世界高度。
  // 把镜头直接架在小狗重心的视线上，画面才会稳稳地把整只狗放在正中间。
  camera.position.set(0, centerY, 0).addScaledVector(VIEW_DIRECTION, 9);
  camera.lookAt(0, centerY, 0);
  camera.updateProjectionMatrix();
}

function resize() {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height, false);
  syncCamera();
}

function setDirection(degrees) {
  state.directionDegrees = THREE.MathUtils.clamp(Math.round(Number(degrees) || 0), -90, 90);
  document.getElementById('direction').value = String(state.directionDegrees);
  document.getElementById('direction-output').value =
    `${state.directionDegrees > 0 ? '+' : ''}${state.directionDegrees}°`;
  dogRoot.rotation.y = THREE.MathUtils.degToRad(state.directionDegrees);
  toyWorld.setCharacterTransform(0, 0, dogRoot.rotation.y);
  syncCamera();
}

function syncPlayButton() {
  const button = document.getElementById('play-pause');
  button.dataset.playing = String(state.idlePlaying);
  button.textContent = state.idlePlaying ? '■ 让它坐好' : '▶ 摇起尾巴';
  button.setAttribute('aria-label', state.idlePlaying ? '停止摇尾巴' : '开始摇尾巴');
  document.getElementById('stage-action').textContent =
    state.idlePlaying ? poseName() : '一动不动';
}

function poseName() {
  const pose = DOG_POSES.find((entry) => entry.id === params.pose);
  const coat = DOG_COATS.find((entry) => entry.id === params.coatId);
  return `${coat?.name ?? ''}小狗 · ${pose?.name ?? ''}`;
}

// ---- 控件 -----------------------------------------------------------------

function buildSliders(containerId, descriptors) {
  const container = document.getElementById(containerId);
  for (const descriptor of descriptors) {
    const label = document.createElement('label');
    label.className = 'slider-row';
    const name = document.createElement('span');
    name.textContent = descriptor.name;
    const output = document.createElement('span');
    output.className = 'slider-val';
    output.textContent = Number(params[descriptor.key]).toFixed(2);
    const input = document.createElement('input');
    input.type = 'range';
    input.setAttribute('aria-label', descriptor.name);
    input.min = String(descriptor.min);
    input.max = String(descriptor.max);
    input.step = String(descriptor.step);
    input.value = String(params[descriptor.key]);
    input.dataset.param = descriptor.key;
    input.addEventListener('input', () => {
      params[descriptor.key] = Number(input.value);
      output.textContent = Number(input.value).toFixed(2);
      scheduleRebuild();
    });
    label.append(name, input, output);
    container.appendChild(label);
  }
}

function buildChips(containerId, entries, { get, set, swatch = null }) {
  const container = document.getElementById(containerId);
  for (const entry of entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.dataset.value = entry.id;
    const color = swatch?.(entry);
    button.innerHTML = color
      ? `<span class="swatch" style="background:${color}"></span>${entry.name}`
      : entry.name;
    button.addEventListener('click', () => {
      set(entry);
      syncControls();
      rebuildDraftThenFull();
    });
    container.appendChild(button);
  }
  container.dataset.sync = 'chips';
  container.__getValue = get;
}

function syncControls() {
  document.getElementById('saddle-color').value = params.saddleColor;
  document.getElementById('under-color').value = params.underColor;
  document.getElementById('eye-color').value = params.eyeColor;
  document.getElementById('eyebrow-dots').checked = params.eyebrowDots;
  document.getElementById('tongue-out').checked = params.tongueOut;
  document.getElementById('fluffy').checked = params.fluffy;
  // 炸毛程度只在开着炸毛时才有意义，关掉就整行收起来
  document.getElementById('dog-fur-controls').hidden = !params.fluffy;
  document.querySelectorAll('[data-param]').forEach((input) => {
    const key = input.dataset.param;
    if (input.type !== 'range') return;
    input.value = String(params[key]);
    const value = input.closest('.slider-row')?.querySelector('.slider-val');
    if (value) value.textContent = Number(params[key]).toFixed(2);
  });
  for (const container of document.querySelectorAll('[data-sync="chips"]')) {
    const current = container.__getValue();
    container.querySelectorAll('button').forEach((button) => {
      const selected = button.dataset.value === current;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }
  document.getElementById('stage-action').textContent =
    state.idlePlaying ? poseName() : '一动不动';
}

function applyCoatPreset(coat) {
  params.coatId = coat.id;
  params.saddleColor = coat.saddle;
  params.underColor = coat.under;
}

function randomizeDog() {
  const rng = createRng(randomSeed());
  params.seed = randomSeed();
  for (const [key, range] of Object.entries(RANDOM_RANGES)) {
    params[key] = Math.round(rng.range(range[0], range[1]) * 100) / 100;
  }
  applyCoatPreset(rng.pick(DOG_COATS));
  params.pose = rng.pick(DOG_POSES).id;
  params.earType = rng.pick(DOG_EAR_TYPES).id;
  params.earTip = rng.pick(DOG_EAR_TIPS).id;
  params.eyeColor = rng.pick(DOG_EYE_COLORS).color;
  params.tongueOut = rng.chance(0.6);
  params.eyebrowDots = rng.chance(0.55);
  params.fluffy = rng.chance(0.3);
  state.matSeed = randomSeed();
  state.toySeed = randomSeed();
  syncControls();
  rebuild('full');
  randomizeMat(state.matSeed);
  scatterToys(state.toySeed);
  syncPlayButton();
}

buildSliders('dog-controls', BODY_SLIDERS);
buildSliders('dog-face-controls', FACE_SLIDERS);
buildSliders('dog-fur-controls', FUR_SLIDERS);
buildChips('pose-presets', DOG_POSES, {
  get: () => params.pose,
  set: (entry) => { params.pose = entry.id; },
});
buildChips('ear-presets', DOG_EAR_TYPES, {
  get: () => params.earType,
  set: (entry) => { params.earType = entry.id; },
});
buildChips('ear-tip-presets', DOG_EAR_TIPS, {
  get: () => params.earTip,
  set: (entry) => { params.earTip = entry.id; },
});
buildChips('coat-presets', DOG_COATS, {
  get: () => params.coatId,
  set: applyCoatPreset,
  swatch: (entry) => entry.saddle,
});
buildChips('eye-presets', DOG_EYE_COLORS, {
  get: () => DOG_EYE_COLORS.find((entry) => entry.color === params.eyeColor)?.id ?? '',
  set: (entry) => { params.eyeColor = entry.color; },
  swatch: (entry) => entry.color,
});

document.getElementById('saddle-color').addEventListener('input', (event) => {
  params.saddleColor = event.target.value;
  rebuildDraftThenFull();
});

document.getElementById('under-color').addEventListener('input', (event) => {
  params.underColor = event.target.value;
  rebuildDraftThenFull();
});

document.getElementById('eye-color').addEventListener('input', (event) => {
  params.eyeColor = event.target.value;
  syncControls();
  rebuildDraftThenFull();
});

document.getElementById('eyebrow-dots').addEventListener('change', (event) => {
  params.eyebrowDots = event.target.checked;
  rebuildDraftThenFull();
});

document.getElementById('tongue-out').addEventListener('change', (event) => {
  params.tongueOut = event.target.checked;
  rebuildDraftThenFull();
});

document.getElementById('fluffy').addEventListener('change', (event) => {
  params.fluffy = event.target.checked;
  syncControls();
  rebuildDraftThenFull();
});

document.getElementById('direction').addEventListener('input', (event) => {
  setDirection(event.target.value);
});

document.getElementById('play-pause').addEventListener('click', () => {
  state.idlePlaying = !state.idlePlaying;
  syncPlayButton();
});

document.getElementById('randomize').addEventListener('click', randomizeDog);

document.getElementById('show-mat').addEventListener('change', (event) => {
  state.matVisible = event.target.checked;
  matLayer.setVisible(state.matVisible);
});

document.getElementById('show-toys').addEventListener('change', (event) => {
  state.toysVisible = event.target.checked;
  toyWorld.group.visible = state.toysVisible;
});

document.getElementById('random-mat').addEventListener('click', () => randomizeMat());
document.getElementById('random-toys').addEventListener('click', () => scatterToys(randomSeed()));

// ---- 指针交互：抓玩具 / 揉小狗 ---------------------------------------------

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
// 视线目标是画布内的归一化指针位置，渲染时再指数平滑地追过去，
// 这样眼神是"跟过来"的而不是硬瞬移。
const eyeGazeTarget = new THREE.Vector2();
const eyeGazeCurrent = new THREE.Vector2();

function updateEyeGazeTarget(event) {
  const rect = canvas.getBoundingClientRect();
  eyeGazeTarget.set(
    THREE.MathUtils.clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1),
    THREE.MathUtils.clamp(-((event.clientY - rect.top) / rect.height) * 2 + 1, -1, 1)
  );
}

window.addEventListener('pointermove', updateEyeGazeTarget, { passive: true });
document.documentElement.addEventListener('mouseleave', () => eyeGazeTarget.set(0, 0));
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.22);
const dragPoint = new THREE.Vector3();
const bodyPlane = new THREE.Plane();
const bodyPoint = new THREE.Vector3();
const localPoint = new THREE.Vector3();
const grabOffset = new THREE.Vector3();
const faceOffset = new THREE.Vector3();

function setPointer(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(pointer, camera);
}

function pickToy(event) {
  if (!state.toysVisible) return null;
  setPointer(event);
  const hits = raycaster.intersectObjects(toyWorld.group.children, true);
  for (const hit of hits) {
    let root = hit.object;
    while (root.parent && root.parent !== toyWorld.group) root = root.parent;
    const toy = toyWorld.toys.find((candidate) => candidate.mesh === root);
    if (!toy) continue;
    return { toy, point: hit.point };
  }
  return null;
}

// buildDog 给每个顶点标了所属部位（0 身体 / 1 头 / 2 腿 / 3 尾）。
// 拾取时顺手读出来：抓身体可以自由揉捏，抓脑袋只给一下回弹，
// 否则一把就能把口吻拽进脑袋里，鼻子和嘴全被吞掉。
function pickDog(event) {
  if (!dog) return null;
  setPointer(event);
  const fur = dog.getObjectByName('fur');
  if (!fur) return null;
  const hits = raycaster.intersectObject(fur, false);
  if (!hits.length) return null;
  const hit = hits[0];
  const rigPart = fur.geometry.getAttribute('rigPart');
  hit.isHead = Boolean(rigPart && hit.face && rigPart.getX(hit.face.a) === 1);
  return hit;
}

canvas.addEventListener('pointerdown', (event) => {
  const toyHit = pickToy(event);
  if (toyHit) {
    event.preventDefault();
    toyWorld.grabToy(toyHit.toy, toyHit.point);
    toyDrag = { pointerId: event.pointerId };
    canvas.setPointerCapture(event.pointerId);
    return;
  }

  const dogHit = pickDog(event);
  if (!dogHit) return;
  event.preventDefault();
  // 戳捏的位移全部在狗的局部坐标里计算，转身之后依然跟手。
  localPoint.copy(dogHit.point);
  dog.worldToLocal(localPoint);
  const normal = dogHit.face
    ? dogHit.face.normal.clone().transformDirection(dog.matrixWorld)
    : new THREE.Vector3(0, 0, 1);
  if (dogHit.isHead) {
    // 摸头：只弹一下，形状不跟手
    pulsePoke(
      localPoint,
      normal.clone().applyQuaternion(dogRoot.quaternion.clone().invert()).negate(),
      0.55
    );
    return;
  }
  const slot = beginGrab(localPoint);
  bodyPlane.setFromNormalAndCoplanarPoint(
    camera.getWorldDirection(new THREE.Vector3()).negate(),
    dogHit.point
  );
  bodyDrag = {
    pointerId: event.pointerId,
    slot,
    anchorLocal: localPoint.clone(),
    anchorWorld: dogHit.point.clone(),
    normal,
    moved: false,
  };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', (event) => {
  if (toyDrag && toyDrag.pointerId === event.pointerId) {
    setPointer(event);
    if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) toyWorld.moveGrab(dragPoint);
    return;
  }
  if (!bodyDrag || bodyDrag.pointerId !== event.pointerId) return;
  setPointer(event);
  if (!raycaster.ray.intersectPlane(bodyPlane, bodyPoint)) return;
  grabOffset.copy(bodyPoint).sub(bodyDrag.anchorWorld);
  grabOffset.applyQuaternion(dogRoot.quaternion.clone().invert());
  if (grabOffset.length() > 0.012) bodyDrag.moved = true;
  // 位移是在世界里量的，塞进着色器前要换算回缩放前的解剖坐标
  grabOffset.divideScalar(dog.userData.worldScale);
  // 限幅取头半径的一半：能明显揉动，但不会把整只狗扯变形
  const maxStretch = dog.userData.hr * 0.3;
  grabOffset.z *= 0.35;
  if (grabOffset.length() > maxStretch) grabOffset.setLength(maxStretch);
  setGrabPoint(bodyDrag.slot, bodyDrag.anchorLocal);
  setGrabTarget(bodyDrag.slot, grabOffset);
});

function releasePointer(event) {
  if (toyDrag && toyDrag.pointerId === event.pointerId) {
    toyWorld.releaseGrab();
    toyDrag = null;
  } else if (bodyDrag && bodyDrag.pointerId === event.pointerId) {
    if (!bodyDrag.moved) {
      // 轻点是“戳一下”，回弹带一点点过冲
      const inward = bodyDrag.normal.clone()
        .applyQuaternion(dogRoot.quaternion.clone().invert())
        .negate();
      pulsePoke(bodyDrag.anchorLocal, inward, 0.9);
    }
    endGrab(bodyDrag.slot);
    bodyDrag = null;
  } else {
    return;
  }
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
}

canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);

// ---- 主循环 ---------------------------------------------------------------

function render(time) {
  const delta = Math.min(0.05, Math.max(0, (time - state.lastTime) / 1000));
  state.lastTime = time;
  state.clock += delta;

  updatePokes(delta);
  if (dog) {
    const idleSample = dog.userData.updateIdle(state.clock, delta, state.idlePlaying);
    eyeGazeCurrent.lerp(eyeGazeTarget, 1 - Math.exp(-delta * 12));
    // 转身时再叠一点朝向补偿，侧对镜头也仍然拿眼角瞄着人
    const facing = THREE.MathUtils.clamp(state.directionDegrees / -90, -1, 1);
    dog.userData.updateEyeAnimation(
      state.clock,
      THREE.MathUtils.clamp(eyeGazeCurrent.x + facing * 0.45, -1, 1),
      eyeGazeCurrent.y
    );
    // 舌头是软的，跟着摇尾巴的力度一起甩
    dog.userData.updateTongue(state.clock, Math.abs(idleSample.tailAngle) > 1e-4 ? 1 : 0.25);
    // 呼吸 + 摇尾巴带动的重心晃动：狗摇得起劲时整个后半身都在跟着动
    const wagEnergy = Math.min(Math.abs(idleSample.tailAngle) / 0.5, 1);
    dogRoot.position.y = Math.sin(state.clock * 1.35) * 0.006 * (state.idlePlaying ? 1 : 0);
    dogRoot.rotation.z = Math.sin(state.clock * 13.8) * 0.012 * wagEnergy;
    const face = dog.getObjectByName('face');
    if (face) {
      for (const child of face.children) {
        if (child.userData.skipPokeSync || !child.userData.basePos) continue;
        pokeOffsetAt(child.userData.refPos, null, faceOffset);
        child.position.copy(child.userData.basePos).add(faceOffset);
      }
    }
  }

  toyWorld.step(delta);
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

new ResizeObserver(resize).observe(canvas);
window.addEventListener('resize', resize);

syncControls();
syncPlayButton();
setDirection(45);
randomizeMat(state.matSeed);
matLayer.setVisible(state.matVisible);
toyWorld.group.visible = state.toysVisible;
resize();

try {
  rebuild('full');
  scatterToys(state.toySeed);
  setModelStatus('拖体型滑杆捏形状 · 按住小狗可以揉 · 旁边的玩具都能抓起来');
} catch (error) {
  console.error(error);
  setModelStatus('小狗没有生成成功，请重新打开页面', 'error');
  document.body.dataset.modelReady = 'false';
}
requestAnimationFrame(render);

// 导出给 Codex：把当前这只狗的完整参数和一张定妆照打包带走
createCodexHandoff({
  trigger: document.getElementById('codex-export'),
  capturePreview: () => {
    renderer.render(scene, camera);
    return canvas.toDataURL('image/png');
  },
  getDescriptor: () => ({
    generator: 'Woof Generator',
    version: 1,
    species: 'chinese-village-dog',
    parameters: { ...params },
    scene: {
      directionDegrees: state.directionDegrees,
      wagging: state.idlePlaying,
      matVisible: state.matVisible,
      toysVisible: state.toysVisible,
      toyKinds: [...new Set(toyWorld.toys.map((toy) => toy.kind))],
    },
    bounds: dog?.userData.bounds ?? null,
  }),
});

window.__dogGenerator = {
  getState: () => ({
    parameters: { ...params },
    scene: {
      directionDegrees: state.directionDegrees,
      idlePlaying: state.idlePlaying,
      matVisible: state.matVisible,
      toysVisible: state.toysVisible,
      mat: matLayer.getState(),
      toyKinds: [...new Set(toyWorld.toys.map((toy) => toy.kind))],
    },
    build: dog?.userData.buildTimings ?? null,
    bounds: dog?.userData.bounds ?? null,
  }),
  setDirection,
  setParams: (patch) => {
    Object.assign(params, patch);
    syncControls();
    rebuild('full');
  },
  randomizeDog,
  getPokeDebug: () => ({
    radius: pokeUniforms.uPokeRadius.value,
    active: pokeUniforms.uPokeOff.value.filter((offset) => offset.length() > 1e-4).length,
  }),
  getDebugBounds: () => ({
    dog: dog ? new THREE.Box3().setFromObject(dog).getSize(new THREE.Vector3()).toArray() : null,
    toys: toyWorld.toys.map((toy) => ({
      kind: toy.kind,
      scale: toy.scale,
      position: toy.mesh.position.toArray(),
    })),
    camera: {
      left: camera.left,
      right: camera.right,
      top: camera.top,
      bottom: camera.bottom,
    },
  }),
};
