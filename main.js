(() => {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
  const win = (a, b, edge, x) => smooth(a, a + edge, x) * (1 - smooth(b - edge, b, x));
  const lerp = (a, b, k) => a + (b - a) * k;

  const canvas = document.getElementById('gl');
  const story = document.getElementById('story');
  const chaps = [...document.querySelectorAll('.chap')];
  const CH = chaps.length;

  const ACCENT = 0xff5a1f;
  const PAPER = 0xecebe6;
  const BG = 0x0c0d0e;

  /* ---------- three.js scene ---------- */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 13);

  const SPAN = 3.2, CHORD = 1.6;

  // Everything on the manta is clipped by this plane. While loading it sweeps
  // left to right, so the model is "scanned" into existence.
  const scan = new THREE.Plane(new THREE.Vector3(-1, 0, 0), -9);
  const clipped = (mat) => { mat.clippingPlanes = [scan]; return mat; };

  // The manta's shape: every vertex of every grid goes through this one function
  function warp(x0, y0, ph, out, i) {
    const u = x0 / SPAN, v = y0 / CHORD, au = Math.abs(u);
    const env = Math.max(0, 1 - Math.pow(au, 1.6));
    const sweep = Math.pow(au, 1.4) * 0.8;
    out[i] = x0;
    out[i + 1] = v * CHORD * (0.1 + 0.9 * Math.pow(env, 1.3)) - sweep + 0.35;
    out[i + 2] = (1 - v * v) * env * 0.4 + Math.sin(ph - au * 2.4) * 0.55 * Math.pow(au, 1.4);
  }

  const SEG_X = 36, SEG_Y = 14;
  const bodyGeo = new THREE.PlaneGeometry(SPAN * 2, CHORD * 2, SEG_X, SEG_Y);
  const bodyBase = bodyGeo.attributes.position.array.slice();
  const fill = new THREE.Mesh(bodyGeo, clipped(new THREE.MeshBasicMaterial({
    color: BG, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: THREE.DoubleSide,
  })));
  const wire = new THREE.Mesh(bodyGeo, clipped(new THREE.MeshBasicMaterial({
    color: PAPER, wireframe: true, transparent: true, opacity: 0.5,
  })));

  // Solar skin: a patch on the back that warms up in chapter 5
  const solarGeo = new THREE.PlaneGeometry(3, 1, 14, 4);
  const solarBase = solarGeo.attributes.position.array.slice();
  const solarFill = new THREE.Mesh(solarGeo, clipped(new THREE.MeshBasicMaterial({
    color: ACCENT, transparent: true, opacity: 0.0, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide,
  })));
  const solarWire = new THREE.Mesh(solarGeo, clipped(new THREE.MeshBasicMaterial({
    color: ACCENT, wireframe: true, transparent: true, opacity: 0.35, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  })));

  // Outline traced around the wing's border
  const border = [];
  for (let i = 0; i <= SEG_X; i++) border.push(i);
  for (let j = 1; j <= SEG_Y; j++) border.push(j * (SEG_X + 1) + SEG_X);
  for (let i = SEG_X - 1; i >= 0; i--) border.push(SEG_Y * (SEG_X + 1) + i);
  for (let j = SEG_Y - 1; j >= 1; j--) border.push(j * (SEG_X + 1));
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(border.length * 3), 3));
  const edge = new THREE.LineLoop(edgeGeo, clipped(new THREE.LineBasicMaterial({ color: PAPER })));

  // Cephalic fins (the two "horns" at the front of a manta ray)
  const fins = [-1, 1].map(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    const l = new THREE.LineLoop(g, clipped(new THREE.LineBasicMaterial({ color: PAPER })));
    l.userData.geo = g;
    return l;
  });

  // Spine and engine pods, marked with small orange points
  const glowPts = [];
  for (let k = 0; k < 26; k++) glowPts.push([0, -1.1 + (k / 25) * 2.8]);
  glowPts.push([-1.45, 0.1], [1.45, 0.1], [-2.3, -0.1], [2.3, -0.1]);
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(glowPts.length * 3), 3));
  const glow = new THREE.Points(glowGeo, clipped(new THREE.PointsMaterial({
    color: ACCENT, size: 0.1, transparent: true, opacity: 0.95, depthWrite: false,
  })));

  const TAIL_PTS = 24;
  const tailGeo = new THREE.BufferGeometry();
  tailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TAIL_PTS * 3), 3));
  const tail = new THREE.Line(tailGeo, clipped(new THREE.LineBasicMaterial({ color: ACCENT })));

  const manta = new THREE.Group();
  manta.add(fill, wire, solarFill, solarWire, edge, glow, tail, ...fins);
  scene.add(manta);

  const tmp = new Float32Array(3);

  function shape(ph) {
    const p = bodyGeo.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) warp(bodyBase[i], bodyBase[i + 1], ph, p, i);
    bodyGeo.attributes.position.needsUpdate = true;

    const s = solarGeo.attributes.position.array;
    for (let i = 0; i < s.length; i += 3) {
      warp(solarBase[i], solarBase[i + 1] - 0.05, ph, s, i);
      s[i + 2] += 0.03;
    }
    solarGeo.attributes.position.needsUpdate = true;

    const eg = edgeGeo.attributes.position.array;
    for (let k = 0; k < border.length; k++) {
      const b = border[k] * 3;
      eg[k * 3] = p[b]; eg[k * 3 + 1] = p[b + 1]; eg[k * 3 + 2] = p[b + 2] + 0.012;
    }
    edgeGeo.attributes.position.needsUpdate = true;

    fins.forEach((f, n) => {
      const sx = n ? 1 : -1;
      f.userData.geo.attributes.position.array.set(
        [sx * 0.1, 1.9, 0.38, sx * 0.32, 2.65, 0.32 + Math.sin(ph - 1) * 0.1, sx * 0.55, 1.7, 0.3],
      );
      f.userData.geo.attributes.position.needsUpdate = true;
    });

    const gp = glowGeo.attributes.position.array;
    glowPts.forEach(([gx, gy], k) => {
      warp(gx, gy, ph, tmp, 0);
      gp[k * 3] = tmp[0]; gp[k * 3 + 1] = tmp[1]; gp[k * 3 + 2] = tmp[2] + 0.06;
    });
    glowGeo.attributes.position.needsUpdate = true;

    const tp = tailGeo.attributes.position.array;
    for (let k = 0; k < TAIL_PTS; k++) {
      const f = k / (TAIL_PTS - 1);
      tp[k * 3] = Math.sin(ph - f * 3) * 0.25 * f;
      tp[k * 3 + 1] = -1.25 - f * 3.2;
      tp[k * 3 + 2] = 0.05;
    }
    tailGeo.attributes.position.needsUpdate = true;
  }

  // Scan line that travels along the model while it loads
  const scanLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -3.6, 0), new THREE.Vector3(0, 3.6, 0)]),
    new THREE.LineBasicMaterial({ color: ACCENT }),
  );
  scene.add(scanLine);

  // Sonar rings that pulse out under the manta (chapter 3)
  const sonar = new THREE.Group();
  const rings = [0, 1, 2].map(() => {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.985, 1, 96),
      new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
    );
    sonar.add(m);
    return m;
  });
  sonar.rotation.x = -1.2;
  scene.add(sonar);

  // Faint sea surface that rises into view while the manta skims (chapter 4)
  const seaGeo = new THREE.PlaneGeometry(40, 40, 40, 40);
  const seaBase = seaGeo.attributes.position.array.slice();
  const sea = new THREE.Mesh(seaGeo, new THREE.MeshBasicMaterial({
    color: PAPER, wireframe: true, transparent: true, opacity: 0, depthWrite: false,
  }));
  sea.rotation.x = -1.42;
  sea.position.set(0, -3.1, -2);
  scene.add(sea);

  // Floating debris. The first half is "collected" by the net in chapter 4.
  const N = 700;
  const home = new Float32Array(N * 3);
  const seed = new Float32Array(N);
  const jit = new Float32Array(N * 2);
  const live = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    home[i * 3] = (Math.random() - 0.5) * 30;
    home[i * 3 + 1] = (Math.random() - 0.5) * 16;
    home[i * 3 + 2] = -5 + Math.random() * 7;
    seed[i] = Math.random();
    jit[i * 2] = (Math.random() - 0.5) * 0.5;
    jit[i * 2 + 1] = (Math.random() - 0.5) * 0.5;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(live, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const debris = new THREE.Points(pGeo, new THREE.PointsMaterial({
    size: 0.09, vertexColors: true, transparent: true, opacity: 0,
  }));
  scene.add(debris);

  const nose = new THREE.Vector3();

  /* ---------- pose keyframes (s = scroll position in viewport heights) ---------- */
  const ids = ['x', 'y', 'sc', 'rx', 'ry', 'rz'];
  const loaderPose = { x: 0, y: 0.2, sc: 1.45, rx: -0.75, ry: 0, rz: 0 };
  const poses = [
    // hero
    { x: 3.2,  y: 0.9,  sc: 1.05, rx: -0.8,  ry: -0.3, rz: 0.22 },
    // 1 problem: big on the right, the number sits left
    { x: 3.1,  y: -0.1, sc: 1.3,  rx: -0.85, ry: 0.5,  rz: -0.22 },
    // 2 meet manta: centre stage
    { x: 0,    y: -2.1, sc: 1.25, rx: -0.55, ry: 0,    rz: 0 },
    // 3 detect: slides left, turns toward the sea
    { x: -3.0, y: 0,    sc: 1.2,  rx: -0.75, ry: -0.45, rz: 0.15 },
    // 4 skim: drops low and flattens out
    { x: 0,    y: -1.8, sc: 1.4,  rx: -1.2,  ry: 0,    rz: 0 },
    // 5 solar: right side, back toward the light
    { x: 3.0,  y: 0.1,  sc: 1.25, rx: -0.45, ry: 0.6,  rz: -0.1 },
    // 6 return: heading home
    { x: 0,    y: 1.4,  sc: 1.0,  rx: -0.85, ry: 0.2,  rz: 0 },
    // 7 call to action: back where it started, a little closer
    { x: 3.5,  y: -0.6, sc: 1.2,  rx: -0.8,  ry: -0.35, rz: 0.2 },
  ];
  let keys = [];
  let storyTop = 0, storyRange = 1;

  function layout() {
    const vh = innerHeight;
    storyTop = story.offsetTop;
    storyRange = story.offsetHeight - vh;
    const top = storyTop / vh, len = storyRange / vh;
    keys = poses.map((p, i) => Object.assign({ s: i === 0 ? 0 : top + len * (i - 0.5) / CH }, p));
  }

  const cur = { ...loaderPose };
  const target = { ...loaderPose };
  const ease = (x) => x * x * (3 - 2 * x);

  function pose(s) {
    if (s <= keys[0].s) return Object.assign(target, poses[0]);
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (s <= b.s) {
        const k = ease((s - a.s) / (b.s - a.s));
        for (const p of ids) target[p] = lerp(a[p], b[p], k);
        return;
      }
    }
    Object.assign(target, keys[keys.length - 1]);
  }

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.z = w / h < 1 ? 17 : 13;
    camera.updateProjectionMatrix();
    layout();
  }
  addEventListener('resize', resize);
  addEventListener('load', layout);
  resize();

  /* ---------- DOM bits driven by story progress ---------- */
  const countNum = document.getElementById('countNum');
  const tickWrap = document.getElementById('ticks');
  for (let i = 0; i < 60; i++) tickWrap.appendChild(document.createElement('i'));
  const tickEls = [...tickWrap.children];
  let lastCount = -1;
  const rail = document.getElementById('rail');
  const railIdx = document.getElementById('railIdx');
  const railLabel = document.getElementById('railLabel');
  const railFill = document.getElementById('railFill');
  const tags = [...document.querySelectorAll('.tag')];
  const hudEl = document.querySelector('.hud');
  const hud = {
    solar: document.getElementById('hudSolar'),
    sonar: document.getElementById('hudSonar'),
    net: document.getElementById('hudNet'),
    glider: document.getElementById('hudGlider'),
  };
  // solar, sonar, net, glider status per chapter
  const hudStates = [
    ['idle',       'standby',  'stowed',   'drifting'],
    ['calibrated', 'online',   'stowed',   'on station'],
    ['calibrated', 'scanning', 'stowed',   'patrolling'],
    ['calibrated', 'locked',   'deployed', 'skimming'],
    ['charging',   'locked',   'deployed', 'cruising'],
    ['full',       'standby',  'stowed',   'returning'],
    ['full',       'standby',  'stowed',   'docked'],
  ];
  let lastChap = -2;

  function setHud(ci) {
    if (ci === lastChap) return;
    lastChap = ci;
    const st = hudStates[clamp(ci, 0, CH - 1)];
    hud.solar.textContent = st[0];
    hud.sonar.textContent = st[1];
    hud.net.textContent = st[2];
    hud.glider.textContent = st[3];
  }

  const EDGE = 0.025;
  function updateChapters(sp) {
    chaps.forEach((el, i) => {
      const a = i / CH, b = (i + 1) / CH;
      const fin = smooth(a, a + EDGE, sp);
      const fout = i < CH - 1 ? smooth(b - EDGE, b, sp) : 0;
      const o = fin * (1 - fout);
      el.style.opacity = o.toFixed(3);
      el.style.transform = `translateY(${((1 - fin) * 28 - fout * 28).toFixed(1)}px)`;
      if (el.classList.contains('chap--cta')) el.style.pointerEvents = o > 0.6 ? 'auto' : 'none';
    });
    const ci = clamp(Math.floor(sp * CH), 0, CH - 1);
    // numbered to match the chapter labels (the hero is 01)
    railIdx.textContent = String(ci + 2).padStart(2, '0') + ' / ' + String(CH + 1).padStart(2, '0');
    railLabel.textContent = chaps[ci].dataset.label;
    railFill.style.width = (sp * 100).toFixed(1) + '%';
    rail.style.opacity = (smooth(0, 0.02, sp) * (1 - smooth(0.985, 1, sp))).toFixed(3);
    const count = Math.round(60 * smooth(0.005, 0.07, sp));
    if (count !== lastCount) {
      lastCount = count;
      countNum.textContent = count;
      tickEls.forEach((t, i) => {
        t.className = i < count - 1 ? 'on' : i === count - 1 ? 'head' : '';
      });
    }
  }

  /* ---------- loader state ---------- */
  let loadE = 0;          // eased load progress, 0..1
  let loadDone = false;
  let appear = 0;         // fades the debris field in once the page opens

  /* ---------- main loop ---------- */
  const clock = new THREE.Clock();
  let phase = 0, time = 0;
  const grey = [0.52, 0.51, 0.48], acc = [1, 0.353, 0.122];
  const c = (i, f) => (i + f) / CH; // chapter i, fraction f of the way through

  function frame() {
    const dt = reduceMotion ? 0 : Math.min(clock.getDelta(), 0.05);
    time += dt;

    const y = scrollY;
    const sp = clamp((y - storyTop) / storyRange);
    const s = y / innerHeight;

    // chapter-driven effect strengths
    const wTags = win(c(1, 0), c(2, 0), 0.025, sp);
    const wDetect = win(c(2, 0), c(3, 0), 0.025, sp);
    const wSea = win(c(2, 0.6), c(4, 0.1), 0.04, sp);
    const wSkim = win(c(3, 0), c(4, 0), 0.03, sp);
    const wSolar = win(c(4, 0), c(5, 0), 0.03, sp);
    const highlight = smooth(c(2, 0.15), c(2, 0.7), sp);
    const attract = smooth(c(3, 0.1), c(3, 0.9), sp);
    const vanish = smooth(c(3, 0.8), c(4, 0.1), sp);

    updateChapters(sp);
    setHud(y < storyTop - innerHeight * 0.4 ? 1 : clamp(Math.floor(sp * CH), 0, CH - 1));
    tags.forEach((t) => { t.style.opacity = wTags.toFixed(3); });
    // readouts belong to the story: they stay off the hero and the footer
    hudEl.style.opacity = (smooth(storyTop - innerHeight * 0.4, storyTop, y)
      * (1 - smooth(storyTop + storyRange, storyTop + storyRange + innerHeight * 0.4, y))).toFixed(3);

    // manta pose: the loader pose until the page opens, then follow the scroll
    if (!loadDone) {
      Object.assign(target, loaderPose);
      target.ry = loaderPose.ry + time * 0.55;
    } else {
      pose(s);
    }
    const d = reduceMotion ? 1 : 0.07;
    for (const p of ids) cur[p] += (target[p] - cur[p]) * d;
    const narrow = innerWidth / innerHeight < 1;
    // keep the model inside the frame on squarer windows
    const fitX = clamp(innerWidth / innerHeight / 1.75, 0.65, 1.1);
    manta.position.set(narrow ? 0 : cur.x * fitX, narrow ? cur.y - 2.4 : cur.y, 0);
    manta.scale.setScalar(cur.sc * (narrow ? 0.8 : 1));
    manta.rotation.set(cur.rx, cur.ry + (loadDone ? Math.sin(time * 0.4) * 0.06 : 0), cur.rz);
    manta.updateMatrixWorld();

    phase += dt * 1.5 * (1 + wSkim * 0.9);
    shape(phase);

    // the scan sweeps across the model while loading, then gets out of the way
    const reach = loaderPose.sc * SPAN * 1.15;
    if (loadDone) {
      scan.constant = 99;
      scanLine.visible = false;
    } else {
      const cx = lerp(-reach, reach, loadE);
      scan.constant = cx;
      scanLine.position.set(cx, manta.position.y, 0.5);
      scanLine.scale.setScalar(manta.scale.x);
      scanLine.visible = loadE < 1;
    }

    // solar skin warms up
    solarFill.material.opacity = 0.28 * wSolar;
    solarWire.material.opacity = 0.35 + 0.65 * wSolar;

    // sonar rings follow the manta and ripple outward
    sonar.position.set(manta.position.x, manta.position.y - 0.4, -0.5);
    rings.forEach((r, k) => {
      const ph = (time * 0.45 + k / 3) % 1;
      r.scale.setScalar(0.4 + ph * 6.5 * manta.scale.x);
      r.material.opacity = (1 - ph) * 0.7 * wDetect;
    });

    // sea surface
    sea.material.opacity = 0.14 * wSea;
    if (wSea > 0.01) {
      const sp3 = seaGeo.attributes.position.array;
      for (let i = 0; i < sp3.length; i += 3) {
        sp3[i + 2] = Math.sin(seaBase[i] * 0.45 + time * 1.2) * Math.cos(seaBase[i + 1] * 0.45 + time * 0.8) * 0.28;
      }
      seaGeo.attributes.position.needsUpdate = true;
    }

    // debris: drifts, gets tagged orange, then streams into the net and vanishes
    if (loadDone) appear = Math.min(1, appear + dt * 0.7);
    debris.material.opacity = 0.9 * appear;
    nose.set(0, 1.9, 0.3);
    manta.localToWorld(nose);
    const dx = time * 0.25;
    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      let px = ((home[i3] - dx + 15) % 30 + 30) % 30 - 15;
      let py = home[i3 + 1] + Math.sin(time * 0.5 + seed[i] * 10) * 0.25;
      let pz = home[i3 + 2];
      let c0 = grey[0], c1 = grey[1], c2 = grey[2];

      if (seed[i] < 0.5) {
        const r = seed[i] / 0.5;
        const k = ease(clamp(attract * 1.7 - r * 0.7));
        px = lerp(px, nose.x + jit[i * 2], k);
        py = lerp(py, nose.y + jit[i * 2 + 1], k);
        pz = lerp(pz, nose.z, k);
        c0 = lerp(c0, acc[0], highlight); c1 = lerp(c1, acc[1], highlight); c2 = lerp(c2, acc[2], highlight);
        const keep = 1 - vanish * smooth(0, 0.6, k);
        c0 *= keep; c1 *= keep; c2 *= keep;
      }
      live[i3] = px; live[i3 + 1] = py; live[i3 + 2] = pz;
      col[i3] = c0; col[i3 + 1] = c1; col[i3 + 2] = c2;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  frame();

  /* ---------- loader ---------- */
  const fill$ = document.getElementById('loaderFill');
  const pct$ = document.getElementById('loaderPct');
  const hint$ = document.getElementById('loaderHint');
  const loader = document.getElementById('loader');
  const dur = reduceMotion ? 1 : 3200;
  const t0 = performance.now();
  const steps = [
    [0, 'calibrating sonar'],
    [0.3, 'unfolding wings'],
    [0.58, 'syncing solar array'],
    [0.85, 'scattering debris field'],
  ];

  (function load() {
    const k = Math.min(1, (performance.now() - t0) / dur);
    loadE = smooth(0, 1, k) * 0.6 + k * 0.4; // slow in, slow out, never stalls
    fill$.style.width = loadE * 100 + '%';
    pct$.textContent = String(Math.round(loadE * 100)).padStart(3, '0');
    hint$.textContent = steps.filter((st) => loadE >= st[0]).pop()[1];
    if (k < 1) return requestAnimationFrame(load);
    hint$.textContent = 'ready';
    setTimeout(() => {
      // wrap the spin so the model turns the short way into its hero pose
      cur.ry = ((cur.ry + Math.PI) % (Math.PI * 2)) - Math.PI;
      loadDone = true;
      loader.classList.add('is-done');
      document.body.classList.remove('is-loading');
      // keep the model above the shutters until they have parted
      setTimeout(() => canvas.classList.remove('on-top'), reduceMotion ? 0 : 1700);
    }, reduceMotion ? 0 : 450);
  })();

  /* ---------- reveal on scroll (hero) ---------- */
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { threshold: 0.2 });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

  /* ---------- "contact" lives on the pinned stage, so scroll to the end of the story ---------- */
  document.querySelectorAll('a[href="#contact"]').forEach((a) => {
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      scrollTo({ top: storyTop + storyRange, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  });

  /* ---------- CTA form (concept only: nothing is sent) ---------- */
  const form = document.getElementById('ctaForm');
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = form.elements.email;
    if (!input.value.includes('@')) { input.focus(); return; }
    form.classList.add('is-sent');
    document.getElementById('ctaLabel').textContent = 'Noted. Thank you';
    input.value = '';
  });
})();
