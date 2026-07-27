// 狗的玩具组。
//
// 狗真正会拖来拖去的那些东西：磨牙骨、网球、飞盘、编织绳结、不锈钢饭碗、
// 吱吱猪，还有一只被叼走的拖鞋。
//
// 建模语言和小狗保持一致：Toon 材质 + 反壳描边 + 独立刚体，
// 整个场地看起来是同一支笔画出来的。

const BONE_COLOR = '#f3e7d1';

function seamTexture(THREE, base, seam) {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 80;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 160, 80);
  ctx.strokeStyle = seam;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  // 网球的两道对称曲缝：一条向上鼓、一条向下鼓
  for (const flip of [1, -1]) {
    ctx.beginPath();
    for (let x = 0; x <= 160; x += 4) {
      const y = 40 + flip * Math.cos((x / 160) * Math.PI * 2) * 22;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function ropeTexture(THREE, base, thread) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 64);
  ctx.strokeStyle = thread;
  ctx.lineWidth = 6;
  // 斜向缠绕的编织纹
  for (let i = -64; i < 128; i += 14) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 40, 64);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.repeat.set(3, 1);
  return texture;
}

export function buildDogToys({
  THREE,
  CANNON,
  addToy,
  material,
  gradientMap,
  outlineOf,
  toonMat,
}) {
  const inkMaterial = new THREE.MeshBasicMaterial({ color: '#463228' });

  const makeGroup = (name) => {
    const group = new THREE.Group();
    group.name = name;
    group.userData.addPart = (geometry, color, outline = 0.007) => {
      group.add(new THREE.Mesh(geometry, toonMat(color, gradientMap)), outlineOf(geometry, outline));
    };
    return group;
  };

  // ---- 狗窝垫：三面围边的方垫 ---------------------------------------------
  {
    const bed = makeGroup('dogBedToy');
    const addPart = bed.userData.addPart;
    const cushion = new THREE.BoxGeometry(0.78, 0.09, 0.62);
    cushion.translate(0, 0.055, 0);
    addPart(cushion, '#e8d3ad', 0.011);
    // 围边只做后三面，正面敞开，狗从正面走进去
    const bolsterDefs = [
      { size: [0.82, 0.16, 0.12], at: [0, 0.11, -0.33] },
      { size: [0.12, 0.16, 0.62], at: [-0.37, 0.11, -0.02] },
      { size: [0.12, 0.16, 0.62], at: [0.37, 0.11, -0.02] },
    ];
    for (const bolster of bolsterDefs) {
      const geometry = new THREE.BoxGeometry(...bolster.size);
      geometry.translate(...bolster.at);
      addPart(geometry, '#c07f4f', 0.011);
    }
    const body = new CANNON.Body({
      mass: 1.5, material,
      position: new CANNON.Vec3(-1.3, 0.4, -0.55),
      linearDamping: 0.32, angularDamping: 0.62,
    });
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.42, 0.1, 0.34)), new CANNON.Vec3(0, 0.095, 0));
    addToy(bed, body, 0.56, 'dogBed');
  }

  // ---- 磨牙骨 x2 ----------------------------------------------------------
  const boneDefs = [
    { scale: 1, pos: [0.95, 0.5, 0.6], yaw: 0.4 },
    { scale: 0.82, pos: [-1.15, 0.45, 0.7], yaw: -0.7 },
  ];
  for (const definition of boneDefs) {
    const bone = makeGroup('boneToy');
    const addPart = bone.userData.addPart;
    const shaft = new THREE.CylinderGeometry(0.046, 0.046, 0.28, 16);
    shaft.rotateZ(Math.PI / 2);
    addPart(shaft, BONE_COLOR, 0.008);
    // 四个球头，两端各两个：这是骨头最容易被一眼认出来的地方
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const knob = new THREE.SphereGeometry(0.068, 16, 12);
        knob.scale(1, 1, 0.92);
        knob.translate(sx * 0.155, sy * 0.052, 0);
        addPart(knob, BONE_COLOR, 0.008);
      }
    }
    bone.scale.setScalar(definition.scale);
    const body = new CANNON.Body({
      mass: 0.3 * definition.scale, material,
      position: new CANNON.Vec3(...definition.pos),
      linearDamping: 0.28, angularDamping: 0.4,
    });
    body.addShape(new CANNON.Box(new CANNON.Vec3(
      0.225 * definition.scale,
      0.12 * definition.scale,
      0.07 * definition.scale
    )));
    body.quaternion.setFromEuler(0, definition.yaw, 0);
    addToy(bone, body, 0.24 * definition.scale, 'bone');
  }

  // ---- 网球 x2 ------------------------------------------------------------
  const tennisDefs = [
    { r: 0.085, pos: [1.3, 0.5, -0.45] },
    { r: 0.072, pos: [-0.55, 0.44, 1.15] },
  ];
  for (const definition of tennisDefs) {
    const geometry = new THREE.SphereGeometry(definition.r, 24, 18);
    const ball = new THREE.Group();
    ball.name = 'tennisToy';
    ball.add(
      new THREE.Mesh(geometry, new THREE.MeshToonMaterial({
        map: seamTexture(THREE, '#d5dd48', '#f6f3e6'),
        gradientMap,
      })),
      outlineOf(geometry, 0.008)
    );
    const body = new CANNON.Body({
      mass: 0.13, material,
      shape: new CANNON.Sphere(definition.r + 0.008),
      position: new CANNON.Vec3(...definition.pos),
      linearDamping: 0.18, angularDamping: 0.18,
    });
    addToy(ball, body, definition.r + 0.008, 'tennis');
  }

  // ---- 飞盘 ---------------------------------------------------------------
  {
    const frisbee = makeGroup('frisbeeToy');
    const profile = [
      new THREE.Vector2(0, 0.052),
      new THREE.Vector2(0.14, 0.048),
      new THREE.Vector2(0.23, 0.036),
      new THREE.Vector2(0.265, 0.008),
      new THREE.Vector2(0.25, 0),
      new THREE.Vector2(0.21, 0.018),
      new THREE.Vector2(0.1, 0.03),
      new THREE.Vector2(0, 0.032),
    ];
    const discGeometry = new THREE.LatheGeometry(profile, 40);
    discGeometry.computeVertexNormals();
    frisbee.add(
      new THREE.Mesh(discGeometry, toonMat('#ef6f52', gradientMap)),
      outlineOf(discGeometry, 0.01)
    );
    // 盘面上的一圈白环，飞盘平放时也不会读成一块红饼
    const ring = new THREE.TorusGeometry(0.15, 0.012, 8, 40);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, 0.05, 0);
    frisbee.add(new THREE.Mesh(ring, toonMat('#f7ece0', gradientMap)));
    const body = new CANNON.Body({
      mass: 0.22, material,
      position: new CANNON.Vec3(0.35, 0.45, -1.15),
      linearDamping: 0.3, angularDamping: 0.45,
    });
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.25, 0.032, 0.25)), new CANNON.Vec3(0, 0.03, 0));
    addToy(frisbee, body, 0.28, 'frisbee');
  }

  // ---- 编织绳结 x2 --------------------------------------------------------
  const ropeDefs = [
    { base: '#dfcfae', thread: '#b3946a', pos: [-1.35, 0.45, 0.15], yaw: 0.9 },
    { base: '#cddbe6', thread: '#7f9cb4', pos: [0.7, 0.42, 1.2], yaw: -0.35 },
  ];
  for (const definition of ropeDefs) {
    const rope = new THREE.Group();
    rope.name = 'ropeToy';
    const ropeMaterial = new THREE.MeshToonMaterial({
      map: ropeTexture(THREE, definition.base, definition.thread),
      gradientMap,
    });
    const shaft = new THREE.CylinderGeometry(0.042, 0.042, 0.26, 14);
    shaft.rotateZ(Math.PI / 2);
    rope.add(new THREE.Mesh(shaft, ropeMaterial), outlineOf(shaft, 0.008));
    // 两端各一个打结的球，中间的绳身明显更细
    for (const sx of [-1, 1]) {
      const knot = new THREE.SphereGeometry(0.075, 16, 12);
      knot.scale(1.05, 1, 1);
      knot.translate(sx * 0.16, 0, 0);
      rope.add(new THREE.Mesh(knot, ropeMaterial), outlineOf(knot, 0.008));
      // 结外散开的绳头
      for (const sy of [-1, 0, 1]) {
        const tuft = new THREE.ConeGeometry(0.022, 0.07, 8);
        tuft.rotateZ(sx * -Math.PI / 2);
        tuft.translate(sx * 0.255, sy * 0.032, sy * 0.02);
        rope.add(new THREE.Mesh(tuft, ropeMaterial));
      }
    }
    const body = new CANNON.Body({
      mass: 0.2, material,
      position: new CANNON.Vec3(...definition.pos),
      linearDamping: 0.32, angularDamping: 0.48,
    });
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.24, 0.082, 0.082)));
    body.quaternion.setFromEuler(0, definition.yaw, 0);
    addToy(rope, body, 0.26, 'rope');
  }

  // ---- 狗饭碗：不锈钢盆 + 一堆狗粮 ----------------------------------------
  {
    const bowl = new THREE.Group();
    bowl.name = 'bowlToy';
    const profile = [
      new THREE.Vector2(0, 0.01),
      new THREE.Vector2(0.13, 0.012),
      new THREE.Vector2(0.2, 0.08),
      new THREE.Vector2(0.215, 0.135),
      new THREE.Vector2(0.19, 0.14),
      new THREE.Vector2(0.165, 0.085),
      new THREE.Vector2(0.1, 0.045),
      new THREE.Vector2(0, 0.042),
    ];
    const bowlGeometry = new THREE.LatheGeometry(profile, 32);
    bowlGeometry.computeVertexNormals();
    bowl.add(
      new THREE.Mesh(bowlGeometry, toonMat('#b9c3ca', gradientMap)),
      outlineOf(bowlGeometry, 0.01)
    );
    // 碗里的狗粮：小圆粒堆成一个矮丘
    const kibbleMaterial = toonMat('#9a6636', gradientMap);
    for (let i = 0; i < 14; i++) {
      const angle = i * 2.399963229728653;
      const radius = 0.135 * Math.sqrt((i + 0.5) / 14);
      const kibble = new THREE.SphereGeometry(0.026, 10, 8);
      kibble.scale(1.15, 0.8, 1);
      kibble.translate(
        Math.cos(angle) * radius,
        0.062 + (1 - radius / 0.16) * 0.018,
        Math.sin(angle) * radius
      );
      bowl.add(new THREE.Mesh(kibble, kibbleMaterial));
    }
    const body = new CANNON.Body({
      mass: 0.5, material,
      position: new CANNON.Vec3(1.35, 0.4, 0.35),
      linearDamping: 0.34, angularDamping: 0.6,
    });
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.2, 0.075, 0.2)), new CANNON.Vec3(0, 0.072, 0));
    addToy(bowl, body, 0.24, 'bowl');
  }

  // ---- 吱吱猪 -------------------------------------------------------------
  {
    const piggy = makeGroup('piggyToy');
    const addPart = piggy.userData.addPart;
    const bodyGeometry = new THREE.SphereGeometry(0.13, 22, 16);
    bodyGeometry.scale(1.22, 1, 0.98);
    bodyGeometry.translate(-0.02, 0.02, 0);
    addPart(bodyGeometry, '#f0a3b4', 0.009);

    const headGeometry = new THREE.SphereGeometry(0.095, 20, 14);
    headGeometry.translate(0.135, 0.055, 0);
    addPart(headGeometry, '#f4b1c0', 0.008);

    // 猪鼻：一个扁圆盘 + 两个鼻孔，是这个玩具的全部笑点
    const snout = new THREE.CylinderGeometry(0.048, 0.048, 0.035, 18);
    snout.rotateZ(Math.PI / 2);
    snout.translate(0.225, 0.045, 0);
    addPart(snout, '#e2809a', 0.006);
    for (const side of [-1, 1]) {
      const nostril = new THREE.SphereGeometry(0.011, 8, 6);
      nostril.translate(0.243, 0.045, side * 0.019);
      piggy.add(new THREE.Mesh(nostril, inkMaterial));

      const ear = new THREE.ConeGeometry(0.038, 0.062, 3);
      ear.rotateY(Math.PI / 2);
      ear.rotateZ(-0.5);
      ear.translate(0.115, 0.135, side * 0.05);
      addPart(ear, '#e895a8', 0.006);

      const eye = new THREE.SphereGeometry(0.014, 10, 8);
      eye.translate(0.195, 0.088, side * 0.052);
      piggy.add(new THREE.Mesh(eye, inkMaterial));

      const highlight = new THREE.SphereGeometry(0.005, 8, 6);
      highlight.translate(0.202, 0.094, side * 0.06);
      piggy.add(new THREE.Mesh(highlight, new THREE.MeshBasicMaterial({ color: '#fff8ec' })));

      for (const front of [1, -1]) {
        const leg = new THREE.CylinderGeometry(0.026, 0.024, 0.06, 10);
        leg.translate(front * 0.075 - 0.02, -0.1, side * 0.062);
        addPart(leg, '#e895a8', 0.005);
      }
    }
    // 卷尾巴
    const tailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.15, 0.05, 0),
      new THREE.Vector3(-0.2, 0.09, 0.02),
      new THREE.Vector3(-0.235, 0.055, -0.02),
      new THREE.Vector3(-0.2, 0.03, 0.01),
    ]);
    const tail = new THREE.TubeGeometry(tailCurve, 20, 0.013, 7);
    addPart(tail, '#e895a8', 0.005);

    const body = new CANNON.Body({
      mass: 0.2, material,
      position: new CANNON.Vec3(0.15, 0.42, 1.25),
      linearDamping: 0.3, angularDamping: 0.44,
    });
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.17, 0.13, 0.13)), new CANNON.Vec3(-0.02, 0.02, 0));
    body.addShape(new CANNON.Sphere(0.095), new CANNON.Vec3(0.135, 0.055, 0));
    body.quaternion.setFromEuler(0, -0.4, 0);
    addToy(piggy, body, 0.3, 'piggy');
  }

  // ---- 被叼走的拖鞋 -------------------------------------------------------
  {
    const slipper = makeGroup('slipperToy');
    const addPart = slipper.userData.addPart;
    const sole = new THREE.SphereGeometry(0.115, 20, 14);
    sole.scale(1.55, 0.34, 0.86);
    sole.translate(0, 0.04, 0);
    addPart(sole, '#8f6a4c', 0.009);
    // 鞋面拱：半个压扁的环，狗一咬就知道是拖鞋
    const vamp = new THREE.TorusGeometry(0.088, 0.032, 10, 24, Math.PI);
    vamp.rotateY(Math.PI / 2);
    vamp.scale(1, 0.78, 1);
    vamp.translate(0.06, 0.055, 0);
    addPart(vamp, '#c2604f', 0.008);
    const heel = new THREE.SphereGeometry(0.075, 16, 12);
    heel.scale(0.62, 0.9, 0.92);
    heel.translate(-0.135, 0.07, 0);
    addPart(heel, '#8f6a4c', 0.008);

    const body = new CANNON.Body({
      mass: 0.24, material,
      position: new CANNON.Vec3(-0.85, 0.42, -1.1),
      linearDamping: 0.34, angularDamping: 0.55,
    });
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.185, 0.06, 0.1)), new CANNON.Vec3(0, 0.05, 0));
    body.quaternion.setFromEuler(0, 0.85, 0);
    addToy(slipper, body, 0.22, 'slipper');
  }
}
