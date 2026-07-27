import * as THREE from 'three';

/**
 * 狗的眼睛贴图。
 *
 * 狗眼不是圆的，这是画狗最容易画错的一处：
 *   - 轮廓是横向的杏仁形，宽明显大于高
 *   - 内眼角（靠鼻子那侧）低、外眼角略高，整条眼裂是斜的
 *   - 上眼睑弧度大、下眼睑近乎平直
 *   - 虹膜是圆的深色，占眼裂高度的六到七成，两个眼角露出白三角
 * 画成一个正圆的大眼球再点个瞳孔，脸再对也会显得 der。
 *
 * innerSide 为 -1 / +1，表示鼻子在这只眼的哪一侧。
 */

const INK = '#463228';

function almondPath(ctx, radius, innerSide, openness = 1) {
  // 局部坐标以眼裂中心为原点，x 向外为正
  // 圆杏仁：宽略大于高，两个眼角只是轻轻收一下，不做成人眼那种尖角。
  // 眼角的高低差也压得很小——差太多会读成"斜眼"。
  const halfWidth = radius * 1.02;
  const halfHeight = radius * 0.84 * openness;
  const inner = -innerSide * halfWidth;
  const outer = innerSide * halfWidth;
  const innerY = -halfHeight * 0.08;
  const outerY = halfHeight * 0.1;

  ctx.beginPath();
  ctx.moveTo(inner, innerY);
  ctx.bezierCurveTo(
    inner + (outer - inner) * 0.24, innerY - halfHeight * 1.42,
    inner + (outer - inner) * 0.74, outerY - halfHeight * 1.36,
    outer, outerY
  );
  ctx.bezierCurveTo(
    inner + (outer - inner) * 0.76, outerY + halfHeight * 1.12,
    inner + (outer - inner) * 0.24, innerY + halfHeight * 1.18,
    inner, innerY
  );
  ctx.closePath();
}

export function createDogEyeTexture(irisColor, irisRatio, _unusedWatery, innerSide) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;

  let lastGazeX = Number.POSITIVE_INFINITY;
  let lastGazeY = Number.POSITIVE_INFINITY;
  let lastBlink = -1;

  const draw = (time = 0, gazeX = 0, gazeY = 0) => {
    const gazeLength = Math.hypot(gazeX, gazeY);
    if (gazeLength > 1) {
      gazeX /= gazeLength;
      gazeY /= gazeLength;
    }
    // 眨眼：大部分时间睁着，偶尔快速合一下
    const blinkPhase = (time * 0.37 + innerSide * 0.11) % 1;
    const blink = blinkPhase > 0.955 ? Math.sin((blinkPhase - 0.955) / 0.045 * Math.PI) : 0;
    const openness = 1 - blink * 0.94;
    if (
      Math.abs(gazeX - lastGazeX) < 0.004
      && Math.abs(gazeY - lastGazeY) < 0.004
      && Math.abs(openness - lastBlink) < 0.01
    ) return;
    lastGazeX = gazeX;
    lastGazeY = gazeY;
    lastBlink = openness;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(2, 2);
    ctx.translate(128, 128);

    const radius = 96;
    // 眼白
    almondPath(ctx, radius, innerSide, openness);
    ctx.fillStyle = '#fffdf8';
    ctx.fill();

    // 虹膜：夹在眼裂里，跟着视线在很小的范围内移动
    ctx.save();
    almondPath(ctx, radius, innerSide, openness);
    ctx.clip();
    // 虹膜要留出眼白。之前让虹膜半径超出眼裂高度，结果是瞳孔一路顶到眼角，
    // 除非把滑杆拉到最小否则完全看不见眼白。改成以眼裂"高度"为上限：
    // 默认档大约占眼裂高的七成，上下各留一线白，两个眼角留出明显的白三角。
    const irisRadius = radius * 0.84
      * THREE.MathUtils.lerp(0.44, 0.9, THREE.MathUtils.clamp(irisRatio, 0, 1));
    const room = Math.max(4, radius * 0.26);
    ctx.beginPath();
    ctx.arc(gazeX * room, -gazeY * room * 0.5, irisRadius, 0, Math.PI * 2);
    ctx.fillStyle = irisColor;
    ctx.fill();
    // 瞳孔：圆瞳
    ctx.beginPath();
    ctx.arc(gazeX * room, -gazeY * room * 0.5, irisRadius * 0.58, 0, Math.PI * 2);
    ctx.fillStyle = '#1e1713';
    ctx.fill();
    // 高光
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(gazeX * room + irisRadius * 0.34, -gazeY * room * 0.5 - irisRadius * 0.36, irisRadius * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(gazeX * room - irisRadius * 0.3, -gazeY * room * 0.5 + irisRadius * 0.4, irisRadius * 0.13, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 眼线：上眼睑比下眼睑重，是手绘感的主要来源
    almondPath(ctx, radius, innerSide, openness);
    ctx.lineWidth = 13;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    ctx.stroke();

    ctx.restore();
    texture.needsUpdate = true;
  };

  draw(0);
  return { texture, draw };
}
