const TAU = Math.PI * 2;

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    img.src = src;
  });

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Fondo negro sólido. Tres piezas que se hablan entre sí:
 *
 *  MONO (uno): late con el bombo. Cada bombo suelta una onda de choque en el suelo.
 *
 *  FOCAS (cuatro, dos a cada lado): quietas. Abren y cierran la boca con la VOZ
 *  (squash & stretch). Al abrir, lanzan arcos de voz hacia el mono.
 *
 *  HILOS: de cada foca al mono viaja la forma de onda real del audio. Se encienden
 *  cuando la foca canta y vibran con el bombo.
 *
 *  Todo comparte UNA paleta: el color cambia con cada mono nuevo y tiñe halos,
 *  ondas, arcos e hilos a la vez. Los efectos van DETRÁS de las imágenes.
 */
export function createSimulation({ canvas, params }) {
  const ctx = canvas.getContext('2d');

  let images = [];
  const sealImages = { open: null, closed: null };
  let index = 0;
  let width = 0;
  let heightPx = 0;

  // ============================================================
  //  MONO
  // ============================================================

  // Posición en el "escenario":
  //   x, y  ∈ [-1, 1]  → fracción del espacio libre en pantalla (0,0 = centro)
  //   nz    ∈ [0, 1]   → profundidad (0 = lejos, 1 = cerca)
  //   z                → escala por profundidad
  const startNz = 0.5;
  const depthY = (nz) => lerp(-0.5, 0.6, nz); // lejos = un poco arriba, cerca = un poco abajo
  const depthScale = (nz) => lerp(params.depthMin, params.depthMax, nz);

  const s = {
    x: 0, y: depthY(startNz), z: 1, vx: 0, vy: 0, vz: 0,
    facing: 1,
    height: 0, // altura sobre el suelo, en "alturas de mono"
    vel: 0,
    stretch: 0, // >0 estirado, <0 aplastado
    stretchVel: 0,
    tilt: 0, // balanceo (radianes)
    tiltVel: 0,
    pump: 0 // escala extra continua
  };
  const target = { x: 0, y: depthY(startNz), z: 1, nz: startNz, facing: 1 };
  s.z = target.z = depthScale(startNz);

  // ============================================================
  //  FOCAS: 2 a la izquierda, 2 a la derecha (centro = fracción de la pantalla)
  // ============================================================

  // bias: desfase de sensibilidad, para que no abran todas exactamente a la vez
  // mouth: 0–1 suavizado de "qué tan abierta está", lo usan los hilos y los halos
  const makeSeal = (side, fx, fy, bias) => ({
    side, fx, fy, bias, open: false, timer: 0, stretch: 0, stretchVel: 0, mouth: 0
  });
  const seals = [
    makeSeal('left', 0.1, 0.3, 0.0),
    makeSeal('left', 0.1, 0.72, 0.08),
    makeSeal('right', 0.9, 0.3, 0.04),
    makeSeal('right', 0.9, 0.72, 0.12)
  ];

  // ============================================================
  //  VISUALES COMPARTIDOS
  // ============================================================

  const fx = {
    hue: params.hueBase, // color actual (se desliza hacia el del mono visible)
    rings: [], // ondas de choque (suelo) y arcos de voz
    kickFlash: 0, // 0–1, sube con cada bombo y cae rápido
    layout: null // dónde se dibujó el mono en el último frame
  };

  const hueOf = (tone) => fx.hue + tone * 40; // tono 0 = mono, tono 1 = focas/voz
  const hsla = (hue, light, alpha) =>
    `hsla(${((hue % 360) + 360) % 360}, ${params.fxSaturation}%, ${light}%, ${clamp(alpha, 0, 1)})`;

  function addRing(ring) {
    ring.age = 0;
    fx.rings.push(ring);
    if (fx.rings.length > 40) fx.rings.shift();
  }

  // ---------- carga y tamaño ----------

  async function load() {
    const base = import.meta.env.BASE_URL;
    // encodeURIComponent: los nombres con espacio ("foca abierta.png") necesitan %20
    const sealUrl = (file) => `${base}${encodeURIComponent(file)}`;

    const monkeyJobs = Array.from({ length: params.imageCount }, (_, i) =>
      loadImage(`${base}${i + 1}.${params.imageExt}`)
    );
    const [monkeyResults, sealResults] = await Promise.all([
      Promise.allSettled(monkeyJobs),
      Promise.allSettled([
        loadImage(sealUrl(params.sealOpenFile)),
        loadImage(sealUrl(params.sealClosedFile))
      ])
    ]);

    images = monkeyResults.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    monkeyResults
      .filter((r) => r.status === 'rejected')
      .forEach((r) => console.warn(r.reason.message));
    if (!images.length) throw new Error('No se cargó ninguna imagen de mono.');

    // Las focas son opcionales: si faltan, solo avisa por consola
    sealImages.open = sealResults[0].status === 'fulfilled' ? sealResults[0].value : null;
    sealImages.closed = sealResults[1].status === 'fulfilled' ? sealResults[1].value : null;
    sealResults
      .filter((r) => r.status === 'rejected')
      .forEach((r) => console.warn(r.reason.message));
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    heightPx = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(heightPx * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ============================================================
  //  CONTROL
  // ============================================================

  function next() {
    const n = images.length;
    if (n < 2) return;
    if (params.order === 'random') {
      let i;
      do i = Math.floor(Math.random() * n);
      while (i === index);
      index = i;
    } else {
      index = (index + 1) % n;
    }
  }

  function toggleOrder() {
    params.order = params.order === 'sequential' ? 'random' : 'sequential';
    return params.order;
  }

  /** Salto en el sitio. strength 0–1; factor escala la altura (la voz salta menos que el bombo). */
  function jump(strength, factor = 1) {
    const peak = params.kickHeight * strength * factor;
    const v0 = Math.sqrt(2 * params.gravity * peak); // velocidad para alcanzar esa altura
    s.vel = Math.max(s.vel, v0);
    s.stretchVel += strength * factor * params.stretchKick;
  }

  /** Elige el siguiente punto del escenario. */
  function pickTarget() {
    const range = params.monkeyRange;
    let nz;
    let x;

    if (Math.random() < params.approachChance && target.nz < 0.8) {
      // Se acerca a la cámara: más grande, un poco más abajo y casi centrado
      nz = 0.9 + Math.random() * 0.1;
      x = (Math.random() * 2 - 1) * range * 0.4;
    } else {
      // Se aleja o se queda a media distancia, siempre lejos del punto anterior
      nz = Math.random() * 0.8;
      let tries = 0;
      do x = (Math.random() * 2 - 1) * range;
      while (Math.abs(x - target.x) < range * 0.5 && ++tries < 8);
    }

    target.nz = nz;
    target.x = x;
    target.y = clamp(depthY(nz) + (Math.random() * 2 - 1) * 0.08, -1, 1);
    target.z = depthScale(nz);
  }

  /** Salto hacia un punto nuevo. Cuanto más lejos va, un poco más alto salta. */
  function hop(strength) {
    pickTarget();
    const dx = target.x - s.x;
    const dy = (target.y - s.y) * 0.5;
    const dist = Math.min(Math.hypot(dx, dy), 2);
    if (Math.abs(dx) > 0.08) target.facing = dx > 0 ? 1 : -1;
    jump(strength, 1 + dist * 0.15);
  }

  /** Con la voz, el mono se desliza un poco hacia un lado. */
  function drift(strength) {
    const range = params.monkeyRange;
    target.x = clamp(target.x + (Math.random() * 2 - 1) * params.voiceDrift * strength, -range, range);
  }

  function wiggle(strength) {
    const sign = Math.random() < 0.5 ? -1 : 1;
    s.tiltVel += sign * strength * params.tiltKick;
  }

  /**
   * Un bombo acaba de sonar. Enciende el destello y lanza una onda de choque desde el suelo
   * bajo el mono. Si `big` (el mono viaja a otro punto), lanza además una segunda onda amplia.
   */
  function beat(strength, big = false) {
    const L = fx.layout;
    if (!L) return;
    fx.kickFlash = Math.max(fx.kickFlash, strength);

    const minDim = Math.min(width, heightPx);
    addRing({
      kind: 'ground', x: L.cx, y: L.groundY,
      r0: L.dw * 0.25, max: L.dw * (big ? 1.9 : 1.1), life: big ? 0.95 : 0.6,
      alpha: (big ? 0.9 : 0.55) * strength, width: minDim * 0.004 * (big ? 1.6 : 1), tone: 0
    });
    if (big) {
      addRing({
        kind: 'ground', x: L.cx, y: L.groundY,
        r0: L.dw * 0.25, max: L.dw * 2.8, life: 1.3,
        alpha: 0.45 * strength, width: minDim * 0.0025, tone: 1
      });
    }
  }

  function reset() {
    Object.assign(s, {
      x: 0, y: depthY(startNz), z: depthScale(startNz), vx: 0, vy: 0, vz: 0, facing: 1,
      height: 0, vel: 0, stretch: 0, stretchVel: 0, tilt: 0, tiltVel: 0, pump: 0
    });
    Object.assign(target, {
      x: 0, y: depthY(startNz), z: depthScale(startNz), nz: startNz, facing: 1
    });
    for (const seal of seals) {
      Object.assign(seal, { open: false, timer: 0, stretch: 0, stretchVel: 0, mouth: 0 });
    }
    fx.rings.length = 0;
    fx.kickFlash = 0;
    index = 0;
    fx.hue = params.hueBase;
  }

  // ============================================================
  //  LAYOUT (dónde está cada cosa en pantalla)
  // ============================================================

  function monkeyLayout() {
    const img = images[index];
    if (!img) return null;

    // Tamaño según la profundidad, respetando la proporción de la imagen
    const box = Math.min(width, heightPx) * params.imageScale * s.z;
    const ratio = img.naturalWidth / img.naturalHeight;
    const dw = ratio >= 1 ? box : box * ratio;
    const dh = ratio >= 1 ? box / ratio : box;
    const scale = 1 + s.pump;

    // Espacio libre para que el mono no se salga de la pantalla
    const margin = Math.min(width, heightPx) * 0.02;
    const availX = Math.max(0, width / 2 - (dw / 2) * scale - margin);
    const availY = Math.max(0, heightPx / 2 - (dh / 2) * scale - margin);
    const cx = width / 2 + s.x * availX;
    const cy = heightPx / 2 + s.y * availY;
    const groundY = cy + dh / 2; // suelo bajo el mono
    const feetY = groundY - s.height * box; // pies (suben al saltar)

    return { img, box, dw, dh, scale, cx, cy, groundY, feetY, midY: feetY - dh / 2 };
  }

  function sealLayout() {
    const minDim = Math.min(width, heightPx);
    // Cuadro de cada foca: nunca más ancho que el 20 % de la pantalla ni más alto que el 40 %
    const box = Math.min(minDim * params.sealScale, width * 0.2, heightPx * 0.4);
    const margin = minDim * 0.02;
    const items = seals.map((seal) => {
      const cx = clamp(seal.fx * width, box / 2 + margin, width - box / 2 - margin);
      const cy = clamp(seal.fy * heightPx, box / 2 + margin, heightPx - box / 2 - margin);
      return { seal, cx, cy, baseY: cy + box / 2 };
    });
    return { box, items };
  }

  // ============================================================
  //  SIMULACIÓN
  // ============================================================

  function updateMonkey(dt, { bass = 0, voice = 0 }) {
    // Viaje por el escenario: muelle críticamente amortiguado (llega sin pasarse)
    const k = params.travelStiffness;
    const c = 2 * Math.sqrt(k);
    s.vx += (k * (target.x - s.x) - c * s.vx) * dt;
    s.vy += (k * (target.y - s.y) - c * s.vy) * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;

    const kz = k * 0.6; // la profundidad cambia un poco más despacio
    const cz = 2 * Math.sqrt(kz);
    s.vz += (kz * (target.z - s.z) - cz * s.vz) * dt;
    s.z += s.vz * dt;

    // Girarse hacia donde va (solo si flipToDirection = 1), despacio
    s.facing += (target.facing - s.facing) * (1 - Math.exp(-dt * 6));

    // Salto con gravedad
    s.vel -= params.gravity * dt;
    s.height += s.vel * dt;
    if (s.height < 0) {
      const impact = -s.vel;
      s.height = 0;
      s.vel = impact > 0.6 ? impact * params.restitution : 0;
      s.stretchVel -= impact * params.squashOnLand; // aplastar al aterrizar
    }

    // Muelles amortiguados: estirar/aplastar y balanceo
    s.stretchVel += (-500 * s.stretch - 18 * s.stretchVel) * dt;
    s.stretch += s.stretchVel * dt;
    s.stretch = clamp(s.stretch, -0.5, 0.5);

    s.tiltVel += (-200 * s.tilt - 11 * s.tiltVel) * dt;
    s.tilt += s.tiltVel * dt;

    s.pump = bass * params.pumpBass + voice * params.pumpVoice;
  }

  /**
   * Focas: la boca sigue a la voz.
   *  - abre cuando la voz supera su promedio reciente (voiceRel > sealOpenRatio) o hay un golpe de voz
   *  - cierra cuando cae por debajo (con histéresis) o hay silencio
   *  - al abrir se estiran y lanzan un arco de voz hacia el mono; al cerrar se aplastan
   */
  function updateSeals(dt, { voiceRel = 0, voiceHit = 0 }) {
    let layout = null; // se calcula solo si hace falta

    for (const seal of seals) {
      seal.timer = Math.max(0, seal.timer - dt);

      const openAt = params.sealOpenRatio + seal.bias;
      const closeAt = Math.max(0.5, openAt - 0.1);

      if (seal.open) {
        if (seal.timer === 0 && voiceRel < closeAt) {
          seal.open = false;
          seal.timer = params.sealMinClosed;
          seal.stretchVel -= params.sealSquash;
        }
      } else if (seal.timer === 0 && (voiceHit > 0 || voiceRel > openAt)) {
        seal.open = true;
        seal.timer = params.sealMinOpen;
        const force = voiceHit > 0 ? voiceHit : clamp((voiceRel - 1) * 2, 0.3, 1);
        seal.stretchVel += params.sealStretch * force;

        // Arco de voz: sale de la foca en dirección al mono
        if (fx.layout) {
          layout ??= sealLayout();
          const it = layout.items.find((item) => item.seal === seal);
          addRing({
            kind: 'arc', x: it.cx, y: it.cy,
            angle: Math.atan2(fx.layout.midY - it.cy, fx.layout.cx - it.cx),
            r0: layout.box * 0.5, max: layout.box * 2.0, life: 0.75,
            alpha: 0.55 * force, width: Math.min(width, heightPx) * 0.003, tone: 1
          });
        }
      }

      seal.stretchVel += (-500 * seal.stretch - 18 * seal.stretchVel) * dt;
      seal.stretch = clamp(seal.stretch + seal.stretchVel * dt, -0.45, 0.45);

      // "Qué tan abierta está": sube rápido, baja un poco más lento
      seal.mouth += ((seal.open ? 1 : 0) - seal.mouth) * (1 - Math.exp(-dt * (seal.open ? 22 : 12)));
    }
  }

  function updateFx(dt) {
    // El color se desliza (por el camino corto) hacia el del mono que se ve ahora
    const hueTarget = params.hueBase + index * params.hueStep;
    const diff = ((hueTarget - fx.hue + 540) % 360) - 180;
    fx.hue += diff * (1 - Math.exp(-dt * 3));

    fx.kickFlash *= Math.exp(-dt * 7);

    for (const ring of fx.rings) ring.age += dt;
    fx.rings = fx.rings.filter((ring) => ring.age < ring.life);
  }

  // audio = { bass, voice, voiceRel, voiceHit, wave, ... }
  function update(dt, audio) {
    updateMonkey(dt, audio);
    updateSeals(dt, audio);
    updateFx(dt);
  }

  // ============================================================
  //  DIBUJO: efectos (detrás) → focas → mono (delante)
  // ============================================================

  function drawGlow(x, y, radius, tone, alpha) {
    if (alpha < 0.003) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, hsla(hueOf(tone), 60, alpha));
    g.addColorStop(1, hsla(hueOf(tone), 50, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  function drawRings() {
    if (params.fxRings <= 0 && params.fxVoiceWaves <= 0) return;
    for (const ring of fx.rings) {
      const gain = ring.kind === 'ground' ? params.fxRings : params.fxVoiceWaves;
      if (gain <= 0) continue;

      const t = ring.age / ring.life;
      const ease = 1 - Math.pow(1 - t, 3); // arranca rápido, termina suave
      const radius = ring.r0 + (ring.max - ring.r0) * ease;

      ctx.strokeStyle = hsla(hueOf(ring.tone), 65, Math.pow(1 - t, 1.6) * ring.alpha * gain);
      ctx.lineWidth = ring.width * (1 - t * 0.6) + 0.5;
      ctx.beginPath();
      if (ring.kind === 'ground') {
        ctx.ellipse(ring.x, ring.y, radius, radius * 0.28, 0, 0, TAU); // círculo visto en perspectiva
      } else {
        ctx.arc(ring.x, ring.y, radius, ring.angle - 0.9, ring.angle + 0.9);
      }
      ctx.stroke();
    }
  }

  /** Hilo de cada foca al mono con la forma de onda REAL del audio. */
  function drawThreads(L, sl, audio) {
    const wave = audio.wave;
    if (params.fxThreads <= 0 || !wave) return;

    const minDim = Math.min(width, heightPx);
    const voice = audio.voice || 0;
    const N = 48;

    sl.items.forEach((it, i) => {
      const alpha = (it.seal.mouth * 0.55 + voice * 0.25) * params.fxThreads;
      if (alpha < 0.02) return;

      // Sale del lado de la foca que mira al centro y llega al pecho del mono
      const dir = it.seal.side === 'left' ? 1 : -1;
      const sx = it.cx + dir * sl.box * 0.38;
      const sy = it.cy + sl.box * 0.05;
      const ex = L.cx;
      const ey = L.midY;
      const dx = ex - sx;
      const dy = ey - sy;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const amp = sl.box * 0.45 * (0.4 + 0.6 * Math.min(1, voice * 1.5));

      // Cada foca lee un tramo distinto del audio, así los hilos no son iguales
      const pts = [];
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        const v = (wave[(i * 512 + Math.floor(t * 480)) % wave.length] - 128) / 128;
        const d = clamp(v * 2.2, -1, 1) * amp * Math.sin(Math.PI * t); // fijo en los extremos
        pts.push([sx + dx * t + nx * d, sy + dy * t + ny * d]);
      }

      const grad = ctx.createLinearGradient(sx, sy, ex, ey);
      grad.addColorStop(0, hsla(hueOf(1), 70, alpha));
      grad.addColorStop(1, hsla(hueOf(0), 65, alpha * 0.7));
      ctx.strokeStyle = grad;
      ctx.lineWidth = minDim * 0.0022 * (1 + fx.kickFlash * 1.5) + 0.5; // el bombo los engrosa
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let k = 1; k < N; k++) {
        const midX = (pts[k][0] + pts[k + 1][0]) / 2;
        const midY = (pts[k][1] + pts[k + 1][1]) / 2;
        ctx.quadraticCurveTo(pts[k][0], pts[k][1], midX, midY);
      }
      ctx.lineTo(pts[N][0], pts[N][1]);
      ctx.stroke();
    });
  }

  function drawEffects(L, sl, audio) {
    const bass = audio.bass || 0;
    const voice = audio.voice || 0;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter'; // suma luz: el fondo negro sigue negro

    // Halos: el del mono respira con los bajos, los de las focas con la voz
    drawGlow(L.cx, L.midY, L.box * (0.8 + fx.kickFlash * 0.2), 0,
      (0.06 + bass * 0.3 + fx.kickFlash * 0.3) * params.fxHalo);
    if (sealImages.open && sealImages.closed) {
      for (const it of sl.items) {
        drawGlow(it.cx, it.cy, sl.box * 0.8, 1,
          (0.04 + it.seal.mouth * 0.3 + voice * 0.1) * params.fxHalo);
      }
    }

    drawRings();
    drawThreads(L, sl, audio);
    ctx.restore();
  }

  function drawSeals(sl, voice) {
    if (!sealImages.open || !sealImages.closed) return;
    const pump = 1 + voice * params.sealPump;

    for (const it of sl.items) {
      const { seal } = it;
      const img = seal.open ? sealImages.open : sealImages.closed;
      const ratio = img.naturalWidth / img.naturalHeight;
      const dw = ratio >= 1 ? sl.box : sl.box * ratio;
      const dh = ratio >= 1 ? sl.box / ratio : sl.box;
      const mirror = seal.side === 'right' && params.sealMirrorRight ? -1 : 1;

      ctx.save();
      ctx.translate(it.cx, it.baseY); // origen en la base: estirar/aplastar queda anclado al suelo
      ctx.scale(pump * (1 - seal.stretch * 0.6) * mirror, pump * (1 + seal.stretch));
      ctx.drawImage(img, -dw / 2, -dh, dw, dh);
      ctx.restore();
    }
  }

  function drawMonkey(L) {
    // Inclinación suave al moverse, además del balanceo de la voz
    const lean = clamp(s.vx * params.lean, -0.12, 0.12);
    const flip = params.flipToDirection ? s.facing : 1;

    ctx.save();
    ctx.translate(L.cx, L.feetY); // origen en los pies: giro y aplastado quedan anclados al suelo
    ctx.rotate(s.tilt + lean);
    ctx.scale(L.scale * (1 - s.stretch * 0.6) * flip, L.scale * (1 + s.stretch));
    ctx.translate(0, -L.dh / 2);
    ctx.drawImage(L.img, -L.dw / 2, -L.dh / 2, L.dw, L.dh);
    ctx.restore();
  }

  function draw(audio = {}) {
    ctx.imageSmoothingEnabled = params.smoothing;
    ctx.imageSmoothingQuality = 'high';

    ctx.fillStyle = params.background;
    ctx.fillRect(0, 0, width, heightPx);

    const L = monkeyLayout();
    fx.layout = L; // beat() y los arcos de voz lo usan para saber dónde está el mono
    if (!L) return;
    const sl = sealLayout();

    drawEffects(L, sl, audio);
    drawSeals(sl, audio.voice || 0);
    drawMonkey(L);
  }

  /** Solo con ?debug en la URL: barras de nivel para afinar la sensibilidad. */
  function drawDebug(frame) {
    ctx.save();
    ctx.font = '12px monospace';
    const rows = [
      ['bass ', frame.bass, frame.kick > 0],
      ['voice', frame.voice, frame.voiceHit > 0]
    ];
    rows.forEach(([name, value, hit], i) => {
      const y = 20 + i * 18;
      ctx.fillStyle = '#888';
      ctx.fillText(name, 12, y + 9);
      ctx.fillStyle = hit ? '#fff' : '#555';
      ctx.fillRect(60, y, value * 160, 10);
    });
    // Nivel relativo de la voz (la boca de las focas abre cuando supera sealOpenRatio)
    ctx.fillStyle = '#888';
    ctx.fillText('rel  ', 12, 20 + 2 * 18 + 9);
    ctx.fillStyle = frame.voiceRel > params.sealOpenRatio ? '#fff' : '#555';
    ctx.fillRect(60, 20 + 2 * 18, Math.min(frame.voiceRel, 2) * 80, 10);
    ctx.restore();
  }

  function dispose() {
    images = [];
    sealImages.open = sealImages.closed = null;
    fx.rings.length = 0;
  }

  resize();

  return {
    load, resize, next, toggleOrder,
    jump, hop, drift, wiggle, beat,
    reset, update, draw, drawDebug, dispose
  };
}