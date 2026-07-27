import * as THREE from 'three';
import { createRng } from './rng.js';
import { injectGroundHatch } from './hatch.js';

const RUG_SIZE = 768;
const OUTLINE_COLOR = '#4a3428';

const PALETTES = [
  { base: '#f6d58a', accent: '#ef9458', accent2: '#79b77b', light: '#fff0cf', ink: '#9a5d44' },
  { base: '#f5b5c8', accent: '#d77caf', accent2: '#7b89cf', light: '#fff0f2', ink: '#95566e' },
  { base: '#a8d789', accent: '#62b17b', accent2: '#f4c75d', light: '#eef8d7', ink: '#4f8a62' },
  { base: '#a9d8df', accent: '#5fa8c1', accent2: '#f2a276', light: '#eff9f4', ink: '#547d86' },
  { base: '#d1b4e9', accent: '#9c78c5', accent2: '#f1a6b4', light: '#f7efff', ink: '#795c91' },
  { base: '#f2a278', accent: '#db7069', accent2: '#6fb5a3', light: '#fff0cf', ink: '#93575a' },
];

const RUG_STYLES = [
  { name: '披萨圆毯', kind: 'circle', draw: drawPizza },
  { name: '棋盘方毯', kind: 'square', draw: drawSquareChecker },
  { name: '条纹长毯', kind: 'rect', draw: drawStriped },
  { name: '圆心花毯', kind: 'circle', draw: drawRoundMedallion },
  { name: '野餐格方毯', kind: 'square', draw: drawGinghamSquare },
  { name: '彩点长毯', kind: 'rect', draw: drawConfettiRect },
  { name: '太阳放射圆毯', kind: 'circle', draw: drawSunburst },
];
const STYLE_NAMES = RUG_STYLES.map((style) => style.name);

function ellipsePath(ctx, rx, ry, rotation = 0) {
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, rotation, 0, Math.PI * 2);
  ctx.closePath();
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function blobPath(ctx, rx, ry, lobes, phase, wobble = 0.08) {
  const count = 112;
  ctx.beginPath();
  for (let i = 0; i <= count; i++) {
    const t = (i / count) * Math.PI * 2;
    const pulse = 1
      + Math.sin(t * lobes + phase) * wobble
      + Math.sin(t * (lobes + 3) - phase * 0.7) * wobble * 0.34;
    const x = Math.cos(t) * rx * pulse;
    const y = Math.sin(t) * ry * pulse;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function fillAndOutline(ctx, fill, ink, width = 12) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.save();
  ctx.translate(2.5, -1.5);
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = Math.max(2, width * 0.34);
  ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawFlower(ctx, x, y, radius, petal, center) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = petal;
  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.rotate((i / 5) * Math.PI * 2);
    ctx.beginPath();
    ctx.ellipse(0, -radius * 0.58, radius * 0.38, radius * 0.64, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = center;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMedallion(ctx, palette) {
  ellipsePath(ctx, 304, 220, -0.025);
  fillAndOutline(ctx, palette.light, palette.ink, 13);

  for (const [rx, ry, color, width] of [
    [270, 190, palette.accent, 18],
    [222, 150, palette.base, 15],
    [168, 106, palette.accent2, 13],
  ]) {
    ellipsePath(ctx, rx, ry, 0.012);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  ctx.fillStyle = palette.accent;
  for (let i = 0; i < 8; i++) {
    ctx.save();
    ctx.rotate((i / 8) * Math.PI * 2);
    ctx.beginPath();
    ctx.moveTo(0, -54);
    ctx.bezierCurveTo(-35, -94, -25, -137, 0, -158);
    ctx.bezierCurveTo(25, -137, 35, -94, 0, -54);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = palette.accent2;
  ctx.beginPath();
  ctx.arc(0, 0, 44, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 7;
  ctx.stroke();
}

function drawStriped(ctx, palette) {
  const x = -336;
  const y = -282;
  const width = 672;
  const height = 564;
  roundedRectPath(ctx, x, y, width, height, 68);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = palette.light;
  ctx.fillRect(x, y, width, height);
  const stripeWidth = 62;
  const colors = [palette.base, palette.accent, palette.accent2, palette.light];
  for (let sx = x - stripeWidth; sx < x + width + stripeWidth; sx += stripeWidth) {
    ctx.save();
    ctx.translate(sx, 0);
    ctx.rotate(-0.045);
    ctx.fillStyle = colors[Math.abs(Math.round(sx / stripeWidth)) % colors.length];
    ctx.fillRect(0, y - 30, stripeWidth * 0.72, height + 60);
    ctx.restore();
  }
  ctx.restore();
  roundedRectPath(ctx, x, y, width, height, 68);
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 13;
  ctx.stroke();
  ctx.strokeStyle = palette.accent2;
  ctx.lineWidth = 8;
  roundedRectPath(ctx, x + 22, y + 22, width - 44, height - 44, 50);
  ctx.stroke();

  ctx.strokeStyle = palette.ink;
  ctx.fillStyle = palette.accent2;
  ctx.lineWidth = 5;
  for (const side of [-1, 1]) {
    for (let i = -9; i <= 9; i++) {
      const ty = i * 27;
      ctx.beginPath();
      ctx.moveTo(side * 336, ty);
      ctx.quadraticCurveTo(side * 354, ty + Math.sin(i) * 5, side * 370, ty + 4);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(side * 373, ty + 4, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawFloralBlob(ctx, palette, rng) {
  blobPath(ctx, 305, 207, 7, rng.range(0, Math.PI * 2), 0.075);
  fillAndOutline(ctx, palette.base, palette.ink, 13);

  for (let i = 0; i < 18; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const radius = Math.sqrt(rng.next());
    const x = Math.cos(angle) * radius * 245;
    const y = Math.sin(angle) * radius * 152;
    drawFlower(
      ctx,
      x,
      y,
      rng.range(11, 20),
      i % 2 ? palette.light : palette.accent,
      i % 3 ? palette.accent2 : palette.ink
    );
  }
}

function drawFace(ctx, palette) {
  ctx.fillStyle = palette.accent;
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 12;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(side * 214, -145, 82, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = palette.light;
    ctx.beginPath();
    ctx.arc(side * 214, -145, 41, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette.accent;
  }
  blobPath(ctx, 300, 214, 6, 0.8, 0.04);
  fillAndOutline(ctx, palette.base, palette.ink, 13);

  ctx.fillStyle = palette.ink;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * 102, -28, 18, 25, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.ellipse(0, 18, 38, 28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, 46);
  ctx.quadraticCurveTo(-35, 84, -69, 57);
  ctx.moveTo(0, 46);
  ctx.quadraticCurveTo(35, 84, 69, 57);
  ctx.stroke();
  ctx.fillStyle = '#ef9a96';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * 164, 52, 36, 19, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawChecker(ctx, palette) {
  ellipsePath(ctx, 308, 218, 0.025);
  ctx.save();
  ctx.clip();
  const cell = 72;
  for (let row = -4; row <= 4; row++) {
    for (let col = -5; col <= 5; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? palette.light : palette.base;
      ctx.fillRect(col * cell, row * cell, cell, cell);
    }
  }
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = palette.accent;
  ctx.fillRect(-360, -20, 720, 40);
  ctx.restore();
  ctx.globalAlpha = 1;
  ellipsePath(ctx, 308, 218, 0.025);
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 13;
  ctx.stroke();
  ellipsePath(ctx, 282, 192, -0.012);
  ctx.strokeStyle = palette.accent2;
  ctx.lineWidth = 8;
  ctx.stroke();
}

function leafPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(-314, 32);
  ctx.bezierCurveTo(-216, -224, 124, -256, 310, -20);
  ctx.bezierCurveTo(178, 228, -178, 230, -314, 32);
  ctx.closePath();
}

function drawLeaf(ctx, palette) {
  leafPath(ctx);
  fillAndOutline(ctx, palette.base, palette.ink, 13);
  ctx.strokeStyle = palette.accent2;
  ctx.lineCap = 'round';
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.moveTo(-250, 36);
  ctx.quadraticCurveTo(0, 18, 246, -18);
  ctx.stroke();
  ctx.lineWidth = 8;
  for (let i = -4; i <= 4; i++) {
    const x = i * 52;
    const y = 14 - i * 5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x - 34, y - 72, x - 82, y - 100);
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 38, y + 68, x + 82, y + 94);
    ctx.stroke();
  }
}

function drawPatchwork(ctx, palette, rng) {
  blobPath(ctx, 304, 210, 9, rng.range(0, Math.PI * 2), 0.055);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = palette.base;
  ctx.fillRect(-360, -270, 720, 540);
  const colors = [palette.light, palette.accent, palette.accent2];
  for (let i = 0; i < 18; i++) {
    ctx.save();
    ctx.translate(rng.range(-270, 270), rng.range(-180, 180));
    ctx.rotate(rng.range(-0.8, 0.8));
    ctx.fillStyle = colors[i % colors.length];
    ctx.beginPath();
    ctx.ellipse(0, 0, rng.range(65, 140), rng.range(42, 96), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  blobPath(ctx, 304, 210, 9, 0.4, 0.055);
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 13;
  ctx.stroke();
}

function drawPizza(ctx, palette, rng) {
  ctx.beginPath();
  ctx.arc(0, 0, 326, 0, Math.PI * 2);
  fillAndOutline(ctx, '#f3cf8a', OUTLINE_COLOR, 14);

  ctx.beginPath();
  ctx.arc(0, 0, 286, 0, Math.PI * 2);
  ctx.fillStyle = '#f2b84f';
  ctx.fill();
  ctx.strokeStyle = '#cf6c42';
  ctx.lineWidth = 11;
  ctx.stroke();

  ctx.strokeStyle = '#a9543d';
  ctx.lineWidth = 7;
  ctx.globalAlpha = 0.8;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(angle) * 284, Math.sin(angle) * 284);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const toppingRings = [
    { radius: 92, count: 5, offset: 0.12 },
    { radius: 196, count: 10, offset: 0.33 },
  ];
  for (const ring of toppingRings) {
    for (let i = 0; i < ring.count; i++) {
      const angle = (i / ring.count) * Math.PI * 2 + ring.offset;
      const x = Math.cos(angle) * ring.radius;
      const y = Math.sin(angle) * ring.radius;
      ctx.fillStyle = '#d75945';
      ctx.beginPath();
      ctx.arc(x, y, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#8d493d';
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.fillStyle = '#9b654d';
      ctx.beginPath();
      ctx.arc(x - 5, y - 4, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#fff3b3';
  for (let i = 0; i < 56; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const radius = Math.sqrt(rng.next()) * 255;
    ctx.beginPath();
    ctx.arc(Math.cos(angle) * radius, Math.sin(angle) * radius, rng.range(2, 5), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawSquareChecker(ctx, palette) {
  const x = -326;
  const y = -326;
  const width = 652;
  const height = 652;
  roundedRectPath(ctx, x, y, width, height, 52);
  ctx.save();
  ctx.clip();
  const cell = 82;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? palette.light : palette.accent;
      ctx.fillRect(x + col * cell, y + row * cell, cell + 1, cell + 1);
    }
  }
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = palette.accent2;
  ctx.fillRect(x, -26, width, 52);
  ctx.fillRect(-26, y, 52, height);
  ctx.restore();
  roundedRectPath(ctx, x, y, width, height, 52);
  ctx.strokeStyle = OUTLINE_COLOR;
  ctx.lineWidth = 14;
  ctx.stroke();
  roundedRectPath(ctx, x + 19, y + 19, width - 38, height - 38, 40);
  ctx.strokeStyle = palette.accent2;
  ctx.lineWidth = 8;
  ctx.stroke();
}

function drawRoundMedallion(ctx, palette) {
  ctx.beginPath();
  ctx.arc(0, 0, 326, 0, Math.PI * 2);
  fillAndOutline(ctx, palette.light, OUTLINE_COLOR, 14);
  for (const [radius, color, width] of [
    [284, palette.accent, 20],
    [232, palette.base, 18],
    [172, palette.accent2, 15],
    [106, palette.accent, 13],
  ]) {
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }
  ctx.fillStyle = palette.accent2;
  for (let i = 0; i < 12; i++) {
    ctx.save();
    ctx.rotate((i / 12) * Math.PI * 2);
    ctx.beginPath();
    ctx.ellipse(0, -130, 35, 82, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.arc(0, 0, 58, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = OUTLINE_COLOR;
  ctx.lineWidth = 7;
  ctx.stroke();
}

function drawGinghamSquare(ctx, palette) {
  const x = -326;
  const y = -326;
  const width = 652;
  const height = 652;
  roundedRectPath(ctx, x, y, width, height, 60);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = palette.light;
  ctx.fillRect(x, y, width, height);
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = palette.base;
  for (let i = -4; i <= 4; i++) {
    ctx.fillRect(i * 92 - 30, y, 60, height);
    ctx.fillRect(x, i * 92 - 30, width, 60);
  }
  ctx.globalAlpha = 0.48;
  ctx.fillStyle = palette.accent;
  for (let row = -4; row <= 4; row++) {
    for (let col = -4; col <= 4; col++) {
      if ((row + col) % 2 === 0) ctx.fillRect(col * 92 - 30, row * 92 - 30, 60, 60);
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  roundedRectPath(ctx, x, y, width, height, 60);
  ctx.strokeStyle = OUTLINE_COLOR;
  ctx.lineWidth = 14;
  ctx.stroke();
}

function drawConfettiRect(ctx, palette, rng) {
  const x = -336;
  const y = -282;
  const width = 672;
  const height = 564;
  roundedRectPath(ctx, x, y, width, height, 72);
  fillAndOutline(ctx, palette.light, OUTLINE_COLOR, 14);
  const colors = [palette.base, palette.accent, palette.accent2, OUTLINE_COLOR];
  for (let i = 0; i < 68; i++) {
    const px = rng.range(x + 34, x + width - 34);
    const py = rng.range(y + 34, y + height - 34);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(rng.range(-1.2, 1.2));
    ctx.fillStyle = colors[i % colors.length];
    if (i % 3 === 0) {
      ctx.beginPath();
      ctx.arc(0, 0, rng.range(7, 14), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-rng.range(5, 9), -rng.range(16, 25), rng.range(10, 18), rng.range(32, 50));
    }
    ctx.restore();
  }
  roundedRectPath(ctx, x + 25, y + 25, width - 50, height - 50, 54);
  ctx.strokeStyle = palette.base;
  ctx.lineWidth = 8;
  ctx.stroke();
}

function drawSunburst(ctx, palette) {
  ctx.beginPath();
  ctx.arc(0, 0, 326, 0, Math.PI * 2);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = palette.light;
  ctx.fillRect(-340, -340, 680, 680);
  for (let i = 0; i < 20; i++) {
    const a0 = (i / 20) * Math.PI * 2;
    const a1 = ((i + 1) / 20) * Math.PI * 2;
    ctx.fillStyle = i % 2 === 0 ? palette.base : palette.accent;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a0) * 360, Math.sin(a0) * 360);
    ctx.lineTo(Math.cos(a1) * 360, Math.sin(a1) * 360);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(0, 0, 326, 0, Math.PI * 2);
  ctx.strokeStyle = OUTLINE_COLOR;
  ctx.lineWidth = 14;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 98, 0, Math.PI * 2);
  ctx.fillStyle = palette.accent2;
  ctx.fill();
  ctx.strokeStyle = OUTLINE_COLOR;
  ctx.lineWidth = 9;
  ctx.stroke();
}

function drawRug(ctx, styleIndex, palette, rng) {
  ctx.clearRect(0, 0, RUG_SIZE, RUG_SIZE);
  ctx.save();
  ctx.translate(RUG_SIZE / 2, RUG_SIZE / 2);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.rotate(rng.range(-0.025, 0.025));

  RUG_STYLES[styleIndex].draw(ctx, palette, rng);

  // 极轻纸粒，不盖住主图案，只让大色块不像数字矢量。
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = palette.ink;
  for (let i = 0; i < 260; i++) {
    ctx.beginPath();
    ctx.arc(rng.range(-300, 300), rng.range(-205, 205), rng.range(0.7, 1.7), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
  ctx.globalAlpha = 1;
}

export function createMatLayer(scene) {
  const topCanvas = document.createElement('canvas');
  topCanvas.width = topCanvas.height = RUG_SIZE;
  const sideCanvas = document.createElement('canvas');
  sideCanvas.width = sideCanvas.height = RUG_SIZE;
  const topTexture = new THREE.CanvasTexture(topCanvas);
  topTexture.colorSpace = THREE.SRGBColorSpace;
  topTexture.generateMipmaps = true;
  topTexture.minFilter = THREE.LinearMipmapLinearFilter;
  topTexture.magFilter = THREE.LinearFilter;
  const sideTexture = new THREE.CanvasTexture(sideCanvas);
  sideTexture.colorSpace = THREE.SRGBColorSpace;
  sideTexture.generateMipmaps = true;
  sideTexture.minFilter = THREE.LinearMipmapLinearFilter;
  sideTexture.magFilter = THREE.LinearFilter;

  // 细分平面在局部 Z 方向轻微鼓起；旋转到地面后，局部 Z 就是世界 Y。
  // 这样垫子会参与光照与阴影，不再只是一张贴地透明图。
  const topGeometry = new THREE.PlaneGeometry(1, 1, 32, 32);
  const positions = topGeometry.attributes.position;
  const uvs = topGeometry.attributes.uv;
  for (let i = 0; i < positions.count; i++) {
    const u = uvs.getX(i) - 0.5;
    const v = uvs.getY(i) - 0.5;
    const radial = Math.min(1, Math.sqrt(u * u * 2.2 + v * v * 2.65));
    const crown = Math.pow(Math.max(0, 1 - radial), 1.7) * 0.034;
    const handRipple = Math.sin((u + 0.5) * Math.PI * 5.2)
      * Math.sin((v + 0.5) * Math.PI * 4.4)
      * Math.max(0, 1 - radial)
      * 0.0025;
    positions.setZ(i, crown + handRipple);
  }
  positions.needsUpdate = true;
  topGeometry.computeVertexNormals();

  const material = injectGroundHatch(new THREE.MeshToonMaterial({
    map: topTexture,
    transparent: false,
    opacity: 1,
    alphaTest: 0.035,
    depthWrite: true,
    side: THREE.DoubleSide,
  }));
  const mesh = new THREE.Mesh(topGeometry, material);
  mesh.name = 'procedural-rug';
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.018;
  mesh.renderOrder = 2;
  mesh.receiveShadow = true;

  // 底层轮廓比顶部略大、略低，形成真实厚度与落地边缘。
  const underlayMaterial = new THREE.MeshToonMaterial({
    map: sideTexture,
    transparent: true,
    opacity: 0.94,
    alphaTest: 0.035,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const underlay = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), underlayMaterial);
  underlay.name = 'procedural-rug-underlay';
  underlay.rotation.x = -Math.PI / 2;
  underlay.position.y = 0.006;
  underlay.renderOrder = 1;
  underlay.receiveShadow = true;

  // 垫子自己也在木地板上留下很轻的落地阴影，视觉上与环境黏合。
  const groundingShadowMaterial = new THREE.MeshBasicMaterial({
    map: sideTexture,
    color: '#5f4939',
    transparent: true,
    opacity: 0.2,
    alphaTest: 0.02,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const groundingShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundingShadowMaterial);
  groundingShadow.name = 'procedural-rug-grounding-shadow';
  groundingShadow.rotation.x = -Math.PI / 2;
  groundingShadow.position.y = 0.002;
  groundingShadow.renderOrder = 0;

  const group = new THREE.Group();
  group.name = 'procedural-rug-layer';
  group.add(groundingShadow, underlay, mesh);
  scene.add(group);

  let currentSeed = null;
  let styleIndex = 0;
  let visible = true;
  const bounds = { width: 2.45, depth: 2.15, centerX: 0, centerZ: 0 };
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  const point = new THREE.Vector3();

  return {
    mesh,
    setSeed(seed) {
      if (seed === currentSeed) return false;
      currentSeed = seed;
      const rng = createRng((seed ^ 0x72a4b19d) >>> 0);
      styleIndex = Math.floor(rng.next() * STYLE_NAMES.length);
      // 垫子的色块继续随机，但所有线稿统一使用与狗、玩具一致的深棕描边。
      const palette = { ...rng.pick(PALETTES), ink: OUTLINE_COLOR };
      drawRug(topCanvas.getContext('2d'), styleIndex, palette, rng);

      // 用同一透明轮廓生成独立底层，颜色比顶部更深，但不是一圈超粗描边。
      const side = sideCanvas.getContext('2d');
      side.clearRect(0, 0, RUG_SIZE, RUG_SIZE);
      side.globalCompositeOperation = 'source-over';
      side.globalAlpha = 1;
      side.drawImage(topCanvas, 0, 0);
      side.globalCompositeOperation = 'source-in';
      // 厚度层使用地毯底色的深色版本，不把整段厚度误读成超粗描边。
      side.fillStyle = new THREE.Color(palette.base)
        .lerp(new THREE.Color(OUTLINE_COLOR), 0.58)
        .getStyle();
      side.fillRect(0, 0, RUG_SIZE, RUG_SIZE);
      side.globalCompositeOperation = 'source-over';

      topTexture.needsUpdate = true;
      sideTexture.needsUpdate = true;
      mesh.userData.style = STYLE_NAMES[styleIndex];
      mesh.userData.kind = RUG_STYLES[styleIndex].kind;
      mesh.userData.seed = seed;
      return true;
    },
    fitToCharacter(character) {
      if (!character) return;
      character.updateMatrixWorld(true);
      box.makeEmpty();

      // Fit from the body/legs/tail surface only. The previous full-object
      // Box3 included the head, ears, eyes and whiskers, so moving the
      // head-size slider also resized and shifted the rug. `rigPart === 1`
      // is the head/ear semantic region of the generated SDF mesh.
      const fur = character.getObjectByName('fur');
      const position = fur?.geometry?.getAttribute('position');
      const rigPart = fur?.geometry?.getAttribute('rigPart');
      if (fur && position && rigPart) {
        for (let index = 0; index < position.count; index++) {
          if (Math.round(rigPart.getX(index)) === 1) continue;
          point
            .fromBufferAttribute(position, index)
            .applyMatrix4(fur.matrixWorld);
          box.expandByPoint(point);
        }
      }
      if (box.isEmpty()) box.setFromObject(character);
      box.getSize(size);
      box.getCenter(center);
      const footprint = Math.max(size.x, size.z);
      const diameter = THREE.MathUtils.clamp(footprint * 1.55 + 2.35, 4.65, 6.8);
      const isRectangle = RUG_STYLES[styleIndex].kind === 'rect';
      const width = diameter * (isRectangle ? 1.05 : 1);
      const depth = diameter * (isRectangle ? 0.9 : 1);
      mesh.position.set(center.x, 0.018, center.z - depth * 0.015);
      mesh.scale.set(width, depth, 1);
      underlay.position.set(mesh.position.x, 0.006, mesh.position.z + depth * 0.008);
      underlay.scale.set(width * 1.03, depth * 1.04, 1);
      groundingShadow.position.set(
        mesh.position.x - width * 0.012,
        0.002,
        mesh.position.z + depth * 0.025
      );
      groundingShadow.scale.set(width * 1.055, depth * 1.075, 1);
      bounds.width = width;
      bounds.depth = depth;
      bounds.centerX = mesh.position.x;
      bounds.centerZ = mesh.position.z;
    },
    setVisible(on) {
      visible = Boolean(on);
      group.visible = visible;
    },
    getState() {
      return {
        seed: currentSeed,
        style: STYLE_NAMES[styleIndex],
        kind: RUG_STYLES[styleIndex].kind,
        visible,
        bounds: { ...bounds },
      };
    },
    getBounds() {
      return { ...bounds };
    },
  };
}
