import * as THREE from 'three';

/**
 * 手绘排线系统（地面影子 + 角色暗面）。
 * 两套完全独立的线条参数：
 *   影子排线：uHatch*（样式 / 粗细 / 密度 / 抖动 / 倾斜）
 *   身上排线：uBody*（同一组参数，独立调节）
 * 屏幕对齐开关 uHatchScreen：开启后线条方向锁定屏幕，转镜头时所有排线始终朝同一方向倾斜。
 * 角色暗面色块：uShadeColor 乘色 + uShadeAlpha 浓度。
 */

export const hatchUniforms = {
  // —— 影子排线 ——
  uHatchFreq: { value: 130.0 },
  uHatchWidth: { value: 0.88 },   // 阈值越高线越细（UI 用 0.95-粗细 映射）
  uHatchJitter: { value: 0.06 },
  uHatchStyle: { value: 0 },      // 0 平行线 / 1 虚线
  uHatchAngle: { value: Math.PI / 4 },
  uHatchDashStretch: { value: 1.0 },
  uGroundShadowColor: { value: new THREE.Color('#9e8a70') },
  uGroundShadowAlpha: { value: 0.24 },
  uGroundHatchColor: { value: new THREE.Color('#5f4d3e') },
  uGroundHatchAlpha: { value: 0.58 },
  // —— 身上排线 ——
  uBodyFreq: { value: 130.0 },
  uBodyWidth: { value: 0.88 },
  uBodyJitter: { value: 0.06 },
  uBodyStyle: { value: 0 },
  uBodyAngle: { value: Math.PI / 4 },
  uBodyDashStretch: { value: 1.0 },
  uBodyHatch: { value: 0.3 },     // 身上排线浓度
  // —— 角色暗面色块 ——
  uShadeAlpha: { value: 0.5 },
  uShadeColor: { value: new THREE.Color('#cfc2b8') },
  // —— 屏幕对齐 ——
  uHatchScreen: { value: 0 },     // 0 世界空间 / 1 屏幕空间（跟随镜头）
  uScreenScale: { value: 1 / 400 }, // gl_FragCoord 像素 → 排线坐标（每帧按缓冲高度更新）
  // —— 主光方向 ——
  uKeyDir: { value: new THREE.Vector3(3.2, 5.5, 4.2).normalize() },
};

// 样式只决定连续或断续；粗细、密度、抖动、倾斜由两种样式共享。
export const HATCH_PRESETS = [
  { id: 0, name: '平行线' },
  { id: 1, name: '虚线' },
];

// 共用 GLSL：参数化的线条函数（q 为排线平面二维坐标）
export const HATCH_GLSL = `
uniform int uHatchScreen;
uniform float uScreenScale;
float hatchLineF(float coord, float wob, float freq, float width) {
  float w = sin(coord * freq + wob) * 0.5 + 0.5;
  return smoothstep(width, min(width + 0.22, 1.0), w);
}
float hatchPatternF(
  vec2 q,
  float freq,
  float width,
  float jitter,
  float angle,
  int style,
  float dashStretch
) {
  // 旋转排线坐标系：r.x 沿线方向，r.y 跨线方向
  float ca = cos(angle), sa = sin(angle);
  vec2 r = vec2(q.x * ca + q.y * sa, -q.x * sa + q.y * ca);
  // 双频正弦扰动模拟手绘线的波浪抖动
  float wobble = (sin(r.y * 17.3 + r.x * 5.1) * 0.6
                + sin((r.x + r.y) * 43.7) * 0.4) * jitter * 8.0;
  if (style == 0) {
    return hatchLineF(r.y, wobble, freq, width);
  }
  // 一长一短交替的断续虚线：长划:短划 = 3:1，隔行错开半个周期（砖缝式）
  float line = hatchLineF(r.y * 1.2, wobble * 0.6, freq, width);
  float lc = r.y * 1.2 * freq + wobble * 0.6;
  float row = floor((lc - 1.5707963) / 6.2831853 + 0.5);
  float t = fract(
    r.x * freq * 0.1 / max(dashStretch, 0.05)
    + wobble * 0.03
    + row * 0.5
  );
  float dash = smoothstep(0.0, 0.02, t) * (1.0 - smoothstep(0.45, 0.47, t))   // 长划 0.45
             + smoothstep(0.57, 0.59, t) * (1.0 - smoothstep(0.72, 0.74, t)); // 短划 0.15
  return line * clamp(dash, 0.0, 1.0);
}
`;

// 地毯曲面直接接收真实 ShadowMap，再在同一曲面上叠加排线。
// 不使用悬空平面或接触阴影贴片，因此不会在脚边形成深度冲突和镂空环。
export function injectGroundHatch(material) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    Object.assign(shader.uniforms, hatchUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundHatchPos;')
      .replace(
        '#include <project_vertex>',
        `vGroundHatchPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
         #include <project_vertex>`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <shadowmap_pars_fragment>',
        '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>'
      )
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vGroundHatchPos;
         uniform vec3 uGroundShadowColor;
         uniform float uGroundShadowAlpha;
         uniform vec3 uGroundHatchColor;
         uniform float uGroundHatchAlpha;
         uniform float uHatchFreq;
         uniform float uHatchWidth;
         uniform float uHatchJitter;
         uniform int uHatchStyle;
         uniform float uHatchAngle;
         uniform float uHatchDashStretch;
         ${HATCH_GLSL}`
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         {
           float groundShadow = 0.0;
           #if defined( USE_SHADOWMAP )
             // 将 ShadowMap 的边缘明确二值化，避免不同接收材质重新带回灰色羽化。
             groundShadow = step(0.5, clamp(1.0 - getShadowMask(), 0.0, 1.0));
           #endif
           // 色块只在真实投影里乘色，不再铺一层独立的灰色椭圆。
           gl_FragColor.rgb = mix(
             gl_FragColor.rgb,
             gl_FragColor.rgb * uGroundShadowColor,
             groundShadow * uGroundShadowAlpha
           );
           vec2 q = uHatchScreen == 1
             ? gl_FragCoord.xy * uScreenScale
             : vec2(vGroundHatchPos.x, vGroundHatchPos.z);
           float line = hatchPatternF(
             q,
             uHatchFreq,
             uHatchWidth,
             uHatchJitter,
             uHatchAngle,
             uHatchStyle,
             uHatchDashStretch
           );
           gl_FragColor.rgb = mix(
             gl_FragColor.rgb,
             gl_FragColor.rgb * uGroundHatchColor * 0.78,
             line * groundShadow * uGroundHatchAlpha
           );
         }`
      );
  };
  material.customProgramCacheKey = () => 'rug-ground-shadow-hatch-v1';
  return material;
}

// 角色暗面：注入 MeshToonMaterial。
// 暗面色块（uShadeColor/uShadeAlpha）+ 独立参数的排线（uBody*）。
export function injectBodyHatch(material) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    Object.assign(shader.uniforms, hatchUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHatchPos;\nvarying vec3 vHatchN;')
      .replace(
        '#include <project_vertex>',
        `vHatchPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
         vHatchN = normalize(mat3(modelMatrix) * objectNormal);
         #include <project_vertex>`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vHatchPos;
         varying vec3 vHatchN;
         uniform float uBodyFreq;
         uniform float uBodyWidth;
         uniform float uBodyJitter;
         uniform int uBodyStyle;
         uniform float uBodyAngle;
         uniform float uBodyDashStretch;
         uniform float uBodyHatch;
         uniform float uShadeAlpha;
         uniform vec3 uShadeColor;
         uniform vec3 uKeyDir;
         ${HATCH_GLSL}`
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         {
            float dnl = dot(normalize(vHatchN), uKeyDir);
            // 二次元硬切：不再用 smoothstep 在明暗交界制造灰色过渡带。
            float darkM = 1.0 - step(0.02, dnl);
           // 暗面色块：底色乘 uShadeColor，浓度 uShadeAlpha 可调
           gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * uShadeColor, darkM * uShadeAlpha);
           // 排线坐标：世界空间用身体表面 x/y 混合坐标；屏幕空间直接用像素坐标（跟随镜头）
           vec2 q = uHatchScreen == 1
             ? gl_FragCoord.xy * uScreenScale
             : vec2(vHatchPos.x * 0.8 + vHatchPos.z * 0.3, vHatchPos.y);
           float bl = hatchPatternF(
             q,
             uBodyFreq,
             uBodyWidth,
             uBodyJitter,
             uBodyAngle,
             uBodyStyle,
             uBodyDashStretch
           );
           gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * uShadeColor * 0.82, bl * darkM * uBodyHatch);
         }`
      );
  };
  return material;
}
