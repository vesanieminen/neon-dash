/* ============================================================
   NEON DASH — a synthwave endless runner
   Vanilla JS + Canvas. No dependencies. Double-click index.html
   to play. 1-player and 2-player (side-by-side parallel tracks).
   ============================================================ */
(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // ---------- palette ----------
  const COLORS = {
    laneA: '#22e0ff',
    laneB: '#ff3df0',
    orb:   '#37f5d8',
    gridA: '#22e0ff',
    horizon: '#ff2e88',
  };
  const POW = {
    shield: { c: '#37f5d8', t: 'S' },
    magnet: { c: '#ff9e3d', t: 'M' },
    mult:   { c: '#ffe93d', t: '2x' },
    slowmo: { c: '#9a6bff', t: 'T' },
  };

  // ---------- constants ----------
  const BASE_SPEED = 380, MAX_SPEED = 1060, ACCEL = 20;
  const G_BASE = 3.6, JUMP = 1.5, JUMP2 = 1.25;   // normalized (band) units
  const SLIDE_TIME = 0.5;

  // ---------- state ----------
  let W = 0, H = 0, DPR = 1;
  let lanes = null;            // array of lane objects
  let mode_ = 1;               // 1 or 2
  let state = 'menu';          // menu | countdown | playing | paused | gameover
  let speed = BASE_SPEED, elapsed = 0, slowmo = 0;
  let worldTime = 0, last = 0;
  let countdownT = 0, goT = 0;
  let shakeT = 0, shakeMag = 0;
  let bests = [0, 0], prevBests = [0, 0];
  let stars = [], mountains = [];
  const justPressed = new Set();
  const particles = [];

  // ---------- tiny helpers ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  function line(a, b, c, d) { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); }
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function txt(s, x, y, o = {}) {
    const { size = 24, color = '#fff', align = 'center', weight = '900', spacing = 0,
            glow = 0, glowColor = null, baseline = 'middle' } = o;
    ctx.save();
    ctx.font = `${weight} ${size}px "Arial Black", "Segoe UI", system-ui, sans-serif`;
    ctx.textBaseline = baseline;
    if (glow) { ctx.shadowColor = glowColor || color; ctx.shadowBlur = glow; }
    ctx.fillStyle = color;
    if (spacing > 0) {
      const chars = [...String(s)], widths = chars.map(c => ctx.measureText(c).width);
      const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
      let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
      ctx.textAlign = 'left';
      chars.forEach((c, i) => { ctx.fillText(c, cx, y); cx += widths[i] + spacing; });
    } else {
      ctx.textAlign = align;
      ctx.fillText(String(s), x, y);
    }
    ctx.restore();
  }
  const fmt = n => Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  // ---------- audio (WebAudio synth, no files) ----------
  const Sfx = (() => {
    let ac = null, master = null, muted = false, musicTimer = null, stepI = 0, nextNote = 0;
    // AudioContext is only created on a real user gesture (see input handler),
    // which satisfies the browser autoplay policy and avoids the "not allowed to
    // start" warning. Every sound call no-ops until unlock() has run.
    function unlock() {
      if (!ac) {
        try {
          ac = new (window.AudioContext || window.webkitAudioContext)();
          master = ac.createGain();
          master.gain.value = muted ? 0 : 0.5;
          master.connect(ac.destination);
        } catch (e) { ac = null; return; }
      }
      if (ac.state === 'suspended') ac.resume();
    }
    const now = () => ac.currentTime;
    function tone(freq, dur, type = 'square', vol = 0.22, slide = 0, delay = 0) {
      if (!ac) return;
      const t0 = now() + delay;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.03);
    }
    function noise(dur, vol = 0.3, cutoff = 1200, delay = 0) {
      if (!ac) return;
      const t0 = now() + delay;
      const n = Math.floor(ac.sampleRate * dur);
      const buf = ac.createBuffer(1, n, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = ac.createBufferSource(); src.buffer = buf;
      const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
      const g = ac.createGain(); g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(master); src.start(t0);
    }
    const midi = m => 440 * Math.pow(2, (m - 69) / 12);
    const bass = [45, 45, 52, 45, 48, 48, 55, 48, 43, 43, 50, 43, 47, 47, 54, 47];
    const chords = [[57, 60, 64], [53, 57, 60], [50, 53, 57], [55, 59, 62]];
    function schedBass(m, t0, dur) {
      const o = ac.createOscillator(), g = ac.createGain(), f = ac.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = midi(m);
      f.type = 'lowpass'; f.frequency.value = 620;
      o.connect(f); f.connect(g); g.connect(master);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.start(t0); o.stop(t0 + dur + 0.03);
    }
    function schedKick(t0) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(150, t0);
      o.frequency.exponentialRampToValueAtTime(45, t0 + 0.12);
      g.gain.setValueAtTime(0.5, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 0.2);
    }
    function schedPad(chord, t0, dur) {
      chord.forEach(m => {
        const o = ac.createOscillator(), g = ac.createGain(), f = ac.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.value = midi(m); o.detune.value = rand(-6, 6);
        f.type = 'lowpass'; f.frequency.value = 900;
        o.connect(f); f.connect(g); g.connect(master);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(0.05, t0 + dur * 0.3);
        g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
        o.start(t0); o.stop(t0 + dur + 0.05);
      });
    }
    function startMusic() {
      stopMusic();
      if (!ac || muted) return;
      stepI = 0; nextNote = now() + 0.1;
      const stepT = (60 / 104) / 4;
      musicTimer = setInterval(() => {
        while (nextNote < now() + 0.12) {
          const s = stepI % 16;
          schedBass(bass[s], nextNote, stepT * 0.95);
          if (s % 4 === 0) schedKick(nextNote);
          if (s === 0) schedPad(chords[(stepI / 16 | 0) % 4], nextNote, stepT * 16);
          stepI++; nextNote += stepT;
        }
      }, 25);
    }
    function stopMusic() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }
    return {
      unlock,
      toggle() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.5; return muted; },
      isMuted() { return muted; },
      jump() { tone(320, 0.12, 'square', 0.2, 320); },
      jump2() { tone(430, 0.12, 'square', 0.18, 320); },
      slide() { noise(0.15, 0.12, 900); tone(180, 0.12, 'sine', 0.1, -60); },
      collect(c) { const f = 520 + Math.min(c, 10) * 45; tone(f, 0.09, 'triangle', 0.2); tone(f * 1.5, 0.08, 'triangle', 0.12, 0, 0.02); },
      power() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.12, 'square', 0.18, 0, i * 0.06)); },
      hit() { noise(0.2, 0.35); tone(160, 0.2, 'sawtooth', 0.28, -120); },
      death() { noise(0.5, 0.5, 800); [330, 262, 196, 131].forEach((f, i) => tone(f, 0.25, 'sawtooth', 0.24, -40, i * 0.09)); },
      over() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, 'triangle', 0.2, -20, i * 0.12)); },
      startMusic, stopMusic,
    };
  })();

  // ---------- layout / resize ----------
  function horizonY() { return (lanes && lanes.length) ? lanes[0].gy : H * 0.5; }

  function layoutLane(l) {
    l.bandTop = l.frac.top * H;
    l.gy = l.frac.gy * H;
    l.bottom = l.frac.bottom * H;
    l.bh = (l.frac.gy - l.frac.top) * H;   // jump-space height in px
    l.x = W * 0.22;                          // runner screen x
  }

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (lanes) lanes.forEach(layoutLane);
    buildBackground();
  }

  function buildBackground() {
    const hy = horizonY();
    stars = [];
    for (let i = 0; i < 90; i++) {
      stars.push({ x: Math.random() * W, y: Math.random() * hy * 0.92, r: rand(0.4, 1.6), ph: rand(0, 6.28), sp: rand(0.5, 1.6) });
    }
    const defs = [
      { amp: H * 0.05, color: '#241149', edge: '#6a2bff', sp: 0.05, seed: 1.7, n1: 3, n2: 7 },
      { amp: H * 0.085, color: '#170a33', edge: '#ff2e88', sp: 0.09, seed: 4.2, n1: 2, n2: 5 },
    ];
    const step = 10;
    mountains = defs.map(L => {
      const pts = [];
      for (let x = 0; x <= W * 2 + step; x += step) {
        // integer wavelengths => ridge tiles seamlessly across one screen-width
        const t = (x / W) * Math.PI * 2;
        const y = hy - L.amp * (0.5 + 0.5 * Math.sin(t * L.n1 + L.seed))
                  - L.amp * 0.5 * (0.5 + 0.5 * Math.sin(t * L.n2 + L.seed * 2));
        pts.push({ x, y });
      }
      return Object.assign({}, L, { pts });
    });
  }

  // ---------- game setup ----------
  function loadBest(i) { try { return parseInt(localStorage.getItem('neondash_best_' + (i + 1)) || '0', 10) || 0; } catch (e) { return 0; } }
  function saveBests() {
    lanes.forEach((l, i) => {
      const s = Math.floor(l.player.score);
      if (s > bests[i]) {
        bests[i] = s;
        try { localStorage.setItem('neondash_best_' + (i + 1), String(s)); } catch (e) {}
      }
    });
  }

  function newPlayer(i) {
    return {
      i, yN: 0, vy: 0, onGround: true, jumps: 0,
      sliding: false, slideT: 0, fastFall: false, alive: true,
      score: 0, combo: 0, comboT: 0, runPhase: rand(0, 6.28),
      shield: false, magnet: 0, mult: 0, invuln: 0, trail: [],
    };
  }

  function startGame(mode) {
    mode_ = mode;
    const cfg = mode === 1
      ? [{ top: 0, gy: 0.80, bottom: 1.0 }]
      : [{ top: 0, gy: 0.40, bottom: 0.50 }, { top: 0.50, gy: 0.90, bottom: 1.0 }];
    lanes = cfg.map((c, i) => ({
      frac: c,
      color: i === 0 ? COLORS.laneA : COLORS.laneB,
      gridOff: 0, distSince: 0, nextGap: 320, entities: [],
      player: newPlayer(i),
    }));
    lanes.forEach(layoutLane);
    speed = BASE_SPEED; elapsed = 0; slowmo = 0;
    bests = [loadBest(0), loadBest(1)];
    prevBests = [bests[0], bests[1]];
    particles.length = 0;
    state = 'countdown'; countdownT = 3.0; goT = 0;
    buildBackground();
    Sfx.startMusic();
  }

  // ---------- input ----------
  function laneKeys(i) {
    if (mode_ === 1) return { jump: ['KeyW', 'Space', 'ArrowUp', 'KeyF'], slide: ['KeyS', 'ArrowDown', 'KeyG'] };
    if (i === 0) return { jump: ['KeyW', 'Space'], slide: ['KeyS'] };
    return { jump: ['ArrowUp'], slide: ['ArrowDown'] };
  }

  window.addEventListener('keydown', e => {
    const c = e.code;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(c)) e.preventDefault();
    // Only init/resume audio on a genuine (trusted) user gesture so the
    // browser autoplay policy is satisfied.
    if (e.isTrusted) Sfx.unlock();
    if (e.repeat) return;
    justPressed.add(c);

    if (c === 'KeyM') {
      const m = Sfx.toggle();
      if (!m && (state === 'playing' || state === 'countdown')) Sfx.startMusic();
    }

    if (state === 'menu') {
      if (c === 'Digit1' || c === 'Numpad1' || c === 'Space' || c === 'Enter') startGame(1);
      else if (c === 'Digit2' || c === 'Numpad2') startGame(2);
    } else if (state === 'playing') {
      if (c === 'KeyP' || c === 'Escape') { state = 'paused'; }
    } else if (state === 'paused') {
      if (c === 'KeyP' || c === 'Escape') { state = 'playing'; }
    } else if (state === 'gameover') {
      if (c === 'Space' || c === 'Enter') startGame(mode_);
      else if (c === 'KeyM' || c === 'Escape') { state = 'menu'; Sfx.stopMusic(); }
    }
  });

  window.addEventListener('keyup', e => {
    if (!lanes) return;
    const c = e.code;
    for (let i = 0; i < lanes.length; i++) {
      if (laneKeys(i).jump.includes(c)) applyJumpCut(lanes[i].player);
    }
  });

  function applyJumpCut(p) { if (p.alive && p.vy > 0 && p.jumps < 2) p.vy *= 0.5; }

  function tryJump(l) {
    const p = l.player;
    if (!p.alive) return;
    if (p.onGround) {
      p.vy = JUMP; p.onGround = false; p.jumps = 1; p.sliding = false; p.fastFall = false;
      Sfx.jump(); dust(l, 5);
    } else if (p.jumps < 2) {
      p.vy = JUMP2; p.jumps = 2;
      Sfx.jump2(); ring(l, l.x, l.gy - p.yN * l.bh, l.color, 0.6);
    }
  }

  function trySlide(l) {
    const p = l.player;
    if (!p.alive) return;
    if (p.onGround) { p.sliding = true; p.slideT = SLIDE_TIME; p.vy = 0; Sfx.slide(); }
    else { p.fastFall = true; Sfx.slide(); }
  }

  // ---------- particles ----------
  function addParticle(p) { if (particles.length < 420) particles.push(p); }
  function dust(l, n) {
    const p = l.player, y = l.gy - p.yN * l.bh;
    for (let i = 0; i < n; i++) addParticle({
      x: l.x + rand(-8, 8), y, vx: rand(-60, 60), vy: rand(-40, 10),
      life: rand(0.25, 0.5), maxLife: 0.5, size: rand(1.5, 3.5),
      color: l.color, glow: 8, grav: 300, type: 'dot',
    });
  }
  function ring(l, x, y, color, scale) {
    addParticle({ x, y, vx: 0, vy: 0, life: 0.4, maxLife: 0.4, size: 6 * scale, color, glow: 14, grav: 0, type: 'ring' });
  }
  function burst(l, x, y, color, n, power) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, 6.28), s = rand(40, 160) * power;
      addParticle({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.4, 0.9), maxLife: 0.9, size: rand(2, 4.5), color, glow: 12, grav: 260, type: 'dot' });
    }
    ring(l, x, y, color, 1.6);
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.grav * dt;
    }
  }
  function drawParticles() {
    ctx.save();
    for (const p of particles) {
      const a = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = a;
      ctx.shadowColor = p.color; ctx.shadowBlur = p.glow;
      if (p.type === 'ring') {
        const r = p.size * (1 + (1 - a) * 3);
        ctx.strokeStyle = p.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill();
      }
    }
    ctx.restore();
  }

  function shake(m) { shakeMag = Math.max(shakeMag, m); shakeT = 0.28; }

  // ---------- spawner ----------
  const OB = {
    barrier: { wF: 0.026, bF: 0, hF: 0.15 },
    tall:    { wF: 0.030, bF: 0, hF: 0.20 },
    laser:   { wF: 0.030, bF: 0.14, hF: 0.045 },
    drone:   { wF: 0.034, bF: 0.06, hF: 0.10, bob: 0.03 },
  };

  function spawnInLane(l) {
    l.distSince = 0;
    const r = Math.random();
    if (r < 0.60) {
      spawnObstacle(l);
      if (Math.random() < 0.45) spawnOrbArc(l);
    } else if (r < 0.90) {
      spawnOrbCluster(l);
    } else {
      spawnPower(l);
    }
    l.nextGap = Math.max(240, rand(speed * 0.55, speed * 1.15));
  }

  function spawnObstacle(l) {
    const pick = Math.random();
    const type = pick < 0.35 ? 'barrier' : pick < 0.60 ? 'tall' : pick < 0.85 ? 'laser' : 'drone';
    const s = OB[type];
    l.entities.push({ kind: 'ob', type, x: W + 60, wF: s.wF, bF: s.bF, hF: s.hF, bob: s.bob || 0, phase: rand(0, 6.28) });
  }
  function spawnOrbArc(l) {
    const N = 5, spacing = 0.028 * W;
    for (let i = 0; i < N; i++) {
      l.entities.push({ kind: 'orb', x: W + 60 + 90 + i * spacing, wF: 0.020, bF: 0.22, hF: 0.035, phase: i * 0.5 });
    }
  }
  function spawnOrbCluster(l) {
    const N = 6, spacing = 0.030 * W, base = 0.18, arcH = 0.10;
    for (let i = 0; i < N; i++) {
      const bF = base + Math.sin((i / (N - 1)) * Math.PI) * arcH;
      l.entities.push({ kind: 'orb', x: W + 60 + i * spacing, wF: 0.020, bF, hF: 0.035, phase: i * 0.5 });
    }
  }
  function spawnPower(l) {
    const powers = ['shield', 'magnet', 'mult', 'slowmo'];
    const power = powers[Math.floor(Math.random() * powers.length)];
    l.entities.push({ kind: 'pow', power, x: W + 60, wF: 0.026, bF: 0.14, hF: 0.09, phase: rand(0, 6.28) });
  }

  // ---------- physics & collision ----------
  function updatePhysics(l, dt) {
    const p = l.player;
    if (!p.alive) return;
    if (p.sliding) { p.slideT -= dt; if (p.slideT <= 0) p.sliding = false; }
    let g = G_BASE;
    if (p.fastFall && !p.onGround) g += 7;
    p.vy -= g * dt;
    p.yN += p.vy * dt;
    if (p.yN <= 0) {
      if (!p.onGround) {
        if (p.fastFall) { p.fastFall = false; p.sliding = true; p.slideT = 0.25; }
        dust(l, 6);
      }
      p.yN = 0; p.vy = 0; p.onGround = true; p.jumps = 0;
    } else {
      p.onGround = false;
    }
    // trail
    p.trail.push({ feetY: l.gy - p.yN * l.bh });
    if (p.trail.length > 12) p.trail.shift();
  }

  function comboMult(p) { return Math.min(8, 1 + Math.floor(p.combo / 3)); }

  function playerBox(l, p) {
    const feetY = l.gy - p.yN * l.bh;
    const hFrac = p.sliding ? 0.13 : 0.24;
    const ph = hFrac * l.bh * 0.92;
    const pw = 0.030 * W * 0.8;
    return { x: l.x - pw / 2, y: feetY - ph, w: pw, h: ph };
  }
  function eBox(l, e) {
    const w = e.wF * W;
    const bF = e.bF + (e.bob ? Math.sin(e.phase + worldTime * 3) * e.bob : 0);
    const h = e.hF * l.bh;
    const bottom = l.gy - bF * l.bh;
    return { x: e.x - w / 2, y: bottom - h, w, h };
  }
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const expand = (b, m) => ({ x: b.x - m, y: b.y - m, w: b.w + m * 2, h: b.h + m * 2 });

  function applyPower(p, power) {
    if (power === 'shield') p.shield = true;
    else if (power === 'magnet') p.magnet = 8;
    else if (power === 'mult') p.mult = 8;
    else if (power === 'slowmo') slowmo = 5;
  }

  function killPlayer(l) {
    const p = l.player;
    p.alive = false; p.sliding = false; p.trail.length = 0;
    const y = l.gy - p.yN * l.bh;
    burst(l, l.x, y, l.color, 34, 1.6);
    shake(16);
    Sfx.death();
  }

  function handleCollisions(l) {
    const p = l.player;
    if (!p.alive) return;
    const pb = playerBox(l, p);
    const grab = expand(pb, 8);
    for (const e of l.entities) {
      if (e.collected) continue;
      const eb = eBox(l, e);
      if (e.kind === 'ob') {
        if (p.invuln > 0) continue;
        if (overlap(pb, eb)) {
          if (p.shield) {
            p.shield = false; e.collected = true; p.invuln = 1.0;
            burst(l, eb.x + eb.w / 2, eb.y + eb.h / 2, POW.shield.c, 14, 1.0);
            shake(8); Sfx.hit();
          } else {
            killPlayer(l);
          }
        }
      } else if (e.kind === 'orb') {
        if (overlap(grab, eb)) {
          e.collected = true;
          p.combo++; p.comboT = 4;
          p.score += 10 * comboMult(p) * (p.mult > 0 ? 2 : 1);
          burst(l, eb.x + eb.w / 2, eb.y + eb.h / 2, COLORS.orb, 8, 0.8);
          Sfx.collect(p.combo);
        }
      } else if (e.kind === 'pow') {
        if (overlap(expand(pb, 10), eb)) {
          e.collected = true;
          applyPower(p, e.power);
          p.score += 50 * comboMult(p) * (p.mult > 0 ? 2 : 1);
          const c = POW[e.power].c;
          burst(l, eb.x + eb.w / 2, eb.y + eb.h / 2, c, 16, 1.1);
          shake(4); Sfx.power();
        }
      }
    }
  }

  // ---------- update ----------
  function update(dt) {
    if (shakeT > 0) { shakeT -= dt; if (shakeT <= 0) shakeMag = 0; }
    if (state === 'menu' || state === 'paused') return;

    if (state === 'countdown') {
      countdownT -= dt;
      if (countdownT <= 0) { state = 'playing'; goT = 0.7; }
      updateParticles(dt);
      return;
    }

    const playing = state === 'playing';
    if (playing) {
      elapsed += dt;
      speed = Math.min(MAX_SPEED, BASE_SPEED + elapsed * ACCEL);
      if (slowmo > 0) slowmo -= dt;
    }
    const eff = speed * (slowmo > 0 ? 0.55 : 1);

    for (const l of lanes) {
      l.gridOff += eff * dt;
      if (playing && l.player.alive) {
        l.distSince += eff * dt;
        if (l.distSince >= l.nextGap) spawnInLane(l);
      }
      for (const e of l.entities) e.x -= eff * dt;
      // magnet pulls orbs toward the runner
      const p = l.player;
      if (playing && p.alive && p.magnet > 0) {
        for (const e of l.entities) {
          if (e.kind === 'orb' && e.x > l.x - 30 && e.x < l.x + 280) e.x += (l.x - e.x) * Math.min(1, dt * 8);
        }
      }
      l.entities = l.entities.filter(e => e.x > -140 && !e.collected);

      if (playing) {
        // input
        const k = laneKeys(l.player.i);
        if (k.jump.some(c => justPressed.has(c))) tryJump(l);
        if (k.slide.some(c => justPressed.has(c))) trySlide(l);

        updatePhysics(l, dt);
        if (p.alive) {
          p.score += dt * eff * 0.05;
          p.runPhase += eff * dt * 0.02;
          handleCollisions(l);
          if (p.comboT > 0) { p.comboT -= dt; if (p.comboT <= 0) p.combo = 0; }
          if (p.magnet > 0) p.magnet -= dt;
          if (p.mult > 0) p.mult -= dt;
          if (p.invuln > 0) p.invuln -= dt;
        }
      }
    }

    if (goT > 0) goT -= dt;
    updateParticles(dt);

    if (playing && lanes.every(l => !l.player.alive)) {
      state = 'gameover';
      saveBests();
      Sfx.stopMusic();
      Sfx.over();
    }
  }

  // ---------- drawing ----------
  function drawSun(cx, cy, r) {
    ctx.save();
    ctx.shadowColor = COLORS.horizon; ctx.shadowBlur = 60;
    const g = ctx.createLinearGradient(0, cy - r, 0, cy + r);
    g.addColorStop(0, '#ffd93d'); g.addColorStop(0.5, '#ff7a3d'); g.addColorStop(1, '#ff2e88');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(8,2,20,0.92)';
    for (let i = 0; i < 5; i++) {
      const yy = cy + (i + 1) * r * 0.13;
      ctx.fillRect(cx - r, yy, r * 2, 2 + i * 1.6);
    }
    ctx.restore();
  }

  function drawBackground() {
    const hy = horizonY();
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#05010f');
    g.addColorStop(0.45, '#160435');
    g.addColorStop(0.72, '#3a0a5e');
    g.addColorStop(1, '#0a0118');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // stars
    ctx.save();
    for (const s of stars) {
      const a = 0.35 + 0.55 * Math.abs(Math.sin(worldTime * s.sp + s.ph));
      ctx.globalAlpha = a;
      ctx.fillStyle = '#cfe8ff';
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.restore();

    drawSun(W * 0.5, hy - H * 0.02, H * 0.16);

    // mountains
    const vs = (state === 'playing' || state === 'gameover') ? speed : 160;
    for (const m of mountains) {
      const off = (worldTime * vs * m.sp) % W;
      ctx.save();
      ctx.translate(-off, 0);
      ctx.beginPath();
      ctx.moveTo(m.pts[0].x, hy);
      for (const pt of m.pts) ctx.lineTo(pt.x, pt.y);
      ctx.lineTo(m.pts[m.pts.length - 1].x, hy);
      ctx.closePath();
      ctx.fillStyle = m.color;
      ctx.fill();
      // neon top edge
      ctx.strokeStyle = m.edge; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.7;
      ctx.beginPath();
      for (let i = 0; i < m.pts.length; i++) { const pt = m.pts[i]; if (i) ctx.lineTo(pt.x, pt.y); else ctx.moveTo(pt.x, pt.y); }
      ctx.stroke();
      ctx.restore();
    }

    // dark fill below horizon (hides lower sun, base for grid)
    const fg = ctx.createLinearGradient(0, hy, 0, H);
    fg.addColorStop(0, 'rgba(20,4,40,0.9)');
    fg.addColorStop(1, 'rgba(5,1,15,1)');
    ctx.fillStyle = fg;
    ctx.fillRect(0, hy, W, H - hy);
  }

  function drawGrid(gy, color, bandTop, bandBottom, gridOff) {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, bandTop, W, bandBottom - bandTop); ctx.clip();
    // ground line
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.shadowColor = color; ctx.shadowBlur = 18;
    line(0, gy, W, gy);
    ctx.shadowBlur = 0;
    // vertical scrolling lines
    const cell = 0.05 * W;
    const off = gridOff % cell;
    ctx.globalAlpha = 0.30; ctx.lineWidth = 1; ctx.strokeStyle = color;
    for (let x = -off; x < W; x += cell) line(x, gy, x, bandBottom);
    // horizontal perspective lines
    ctx.globalAlpha = 0.22;
    let yy = gy + 8, gap = 9;
    while (yy < bandBottom) { line(0, yy, W, yy); yy += gap; gap *= 1.35; }
    ctx.restore();
  }

  function drawObstacle(l, e) {
    const b = eBox(l, e);
    const col = e.type === 'laser' ? COLORS.horizon : e.type === 'drone' ? '#7a5cff' : l.color;
    ctx.save();
    ctx.shadowColor = col; ctx.shadowBlur = 16;
    if (e.type === 'laser') {
      // emitter posts
      ctx.fillStyle = '#120726';
      ctx.fillRect(b.x - 3, b.y, 4, l.gy - b.y);
      ctx.fillRect(b.x + b.w - 1, b.y, 4, l.gy - b.y);
      // beam (flicker)
      const fl = 0.7 + 0.3 * Math.sin(worldTime * 40 + e.phase);
      ctx.globalAlpha = fl;
      ctx.fillStyle = col;
      ctx.fillRect(b.x, b.y + b.h * 0.35, b.w, b.h * 0.3);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 24;
      ctx.fillStyle = '#fff';
      ctx.fillRect(b.x, b.y + b.h * 0.42, b.w, b.h * 0.16);
    } else if (e.type === 'drone') {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const hw = b.w / 2, hh = b.h / 2;
      ctx.translate(cx, cy);
      ctx.rotate(Math.sin(worldTime * 2 + e.phase) * 0.15);
      ctx.fillStyle = '#0e0620';
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -hh); ctx.lineTo(hw, 0); ctx.lineTo(0, hh); ctx.lineTo(-hw, 0);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(0, 0, b.w * 0.18, 0, 7); ctx.fill();
    } else {
      // barrier / tall block
      ctx.fillStyle = '#0e0620';
      roundRect(b.x, b.y, b.w, b.h, 4); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      roundRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2, 3); ctx.stroke();
      // inner warning stripes
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      const n = Math.max(2, Math.floor(b.h / 12));
      for (let i = 1; i < n; i++) {
        const yy = b.y + (b.h / n) * i;
        line(b.x + 3, yy, b.x + b.w - 3, yy - 4);
      }
    }
    ctx.restore();
  }

  function drawOrb(l, e) {
    const b = eBox(l, e);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const pulse = 0.7 + 0.3 * Math.sin(worldTime * 6 + e.phase);
    const r = b.w * 0.42 * pulse;
    ctx.save();
    ctx.shadowColor = COLORS.orb; ctx.shadowBlur = 16 * pulse;
    ctx.fillStyle = COLORS.orb;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#eafffb';
    ctx.beginPath(); ctx.arc(cx - r * 0.25, cy - r * 0.25, r * 0.4, 0, 7); ctx.fill();
    ctx.restore();
  }

  function drawPower(l, e) {
    const b = eBox(l, e);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const c = POW[e.power];
    const rot = worldTime * 1.5 + e.phase;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.shadowColor = c.c; ctx.shadowBlur = 18;
    ctx.fillStyle = '#0e0620';
    ctx.strokeStyle = c.c; ctx.lineWidth = 2.5;
    const s = b.w * 0.55;
    ctx.beginPath();
    ctx.moveTo(0, -s); ctx.lineTo(s, 0); ctx.lineTo(0, s); ctx.lineTo(-s, 0);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.rotate(-rot);
    ctx.shadowBlur = 0;
    txt(c.t, 0, 1, { size: b.w * 0.42, color: c.c, weight: '900' });
    ctx.restore();
  }

  function drawRunner(l) {
    const p = l.player, bh = l.bh, x = l.x, feetY = l.gy - p.yN * bh, col = l.color;
    // trail
    for (let i = 0; i < p.trail.length; i++) {
      const t = p.trail[i];
      const a = (i / p.trail.length) * 0.22;
      ctx.save();
      ctx.globalAlpha = a; ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 10;
      const th = 0.20 * bh;
      roundRect(x - 0.015 * bh, t.feetY - th, 0.03 * bh, th, 0.015 * bh);
      ctx.fill();
      ctx.restore();
    }
    // body
    const legs = 0.10 * bh, torso = 0.09 * bh, headR = 0.028 * bh;
    const hipY = p.sliding ? feetY - 0.045 * bh : feetY - legs * 0.5;
    const shoulderY = hipY - (p.sliding ? 0.05 * bh : torso);
    const headCx = x + 0.012 * bh, headCy = shoulderY - headR * 1.25;
    let f1, f2;
    if (p.sliding) { f1 = { x: x + 0.05 * bh, y: feetY }; f2 = { x: x + 0.028 * bh, y: feetY - 0.012 * bh }; }
    else if (!p.onGround) { f1 = { x: x + 0.02 * bh, y: feetY - 0.035 * bh }; f2 = { x: x - 0.022 * bh, y: feetY - 0.05 * bh }; }
    else {
      const s = Math.sin(p.runPhase);
      f1 = { x: x + s * 0.045 * bh, y: feetY };
      f2 = { x: x - s * 0.045 * bh, y: feetY - Math.max(0, Math.cos(p.runPhase)) * 0.035 * bh };
    }
    const sw = Math.sin(p.runPhase + 1.6) * 0.035 * bh;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowColor = col; ctx.shadowBlur = 16; ctx.strokeStyle = col;
    ctx.lineWidth = 0.02 * bh; line(x, hipY, f1.x, f1.y); line(x, hipY, f2.x, f2.y);
    ctx.lineWidth = 0.032 * bh; line(x, hipY, x, shoulderY);
    ctx.lineWidth = 0.016 * bh; line(x, shoulderY + 0.01 * bh, x + sw, shoulderY + 0.035 * bh);
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(headCx, headCy, headR, 0, 7); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = '#eaffff';
    ctx.beginPath(); ctx.arc(headCx + headR * 0.2, headCy - headR * 0.15, headR * 0.45, 0, 7); ctx.fill();
    ctx.restore();
    // shield bubble
    if (p.shield) {
      ctx.save();
      ctx.globalAlpha = 0.4 + 0.3 * Math.sin(worldTime * 6);
      ctx.strokeStyle = POW.shield.c; ctx.shadowColor = POW.shield.c; ctx.shadowBlur = 16; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, feetY - 0.12 * bh, 0.17 * bh, 0, 7); ctx.stroke();
      ctx.restore();
    }
    // power auras
    if (p.magnet > 0) {
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.15 * Math.sin(worldTime * 8);
      ctx.strokeStyle = POW.magnet.c; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, feetY - 0.12 * bh, 0.24 * bh, 0, 7); ctx.stroke();
      ctx.restore();
    }
  }

  function drawDead(l) {
    const x = l.x, y = l.gy;
    ctx.save();
    ctx.globalAlpha = 0.6;
    txt('K.O.', x, y - 0.10 * l.bh, { size: 0.05 * l.bh, color: l.color, glow: 12 });
    ctx.restore();
  }

  function drawLane(l) {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, l.bandTop, W, l.bottom - l.bandTop); ctx.clip();
    drawGrid(l.gy, l.color, l.bandTop, l.bottom, l.gridOff);
    for (const e of l.entities) {
      if (e.collected) continue;
      if (e.kind === 'ob') drawObstacle(l, e);
      else if (e.kind === 'orb') drawOrb(l, e);
      else drawPower(l, e);
    }
    if (l.player.alive) drawRunner(l); else drawDead(l);
    ctx.restore();
  }

  function drawVignette() {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // ---------- HUD & overlays ----------
  function badge(x, y, c, t) {
    ctx.save();
    ctx.shadowColor = c; ctx.shadowBlur = 10;
    ctx.fillStyle = 'rgba(10,4,24,0.8)';
    ctx.strokeStyle = c; ctx.lineWidth = 1.5;
    roundRect(x, y, 26, 22, 6); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    txt(t, x + 13, y + 12, { size: 12, color: c, weight: '900' });
    ctx.restore();
  }

  function drawHUD() {
    lanes.forEach((l, i) => {
      const p = l.player;
      const x = 18, y = l.bandTop + 34;
      if (mode_ === 2) txt('P' + (i + 1), x + 4, y - 4, { align: 'left', size: 13, color: l.color, glow: 8 });
      txt(fmt(p.score), x + 4, y + 20, { align: 'left', size: 32, color: '#fff', glow: 12, glowColor: l.color });
      const nb = p.score >= (prevBests[i] || 0) && p.score > 0;
      txt('BEST ' + fmt(Math.max(bests[i] || 0, Math.floor(p.score))), x + 4, y + 48, { align: 'left', size: 12, color: 'rgba(255,255,255,0.5)' });
      const cm = comboMult(p);
      if (cm > 1 && p.alive) {
        const pop = 1 + Math.max(0, p.comboT - 3.4) * 3;
        txt('x' + cm, x + 4, y + 74 * pop, { align: 'left', size: 26, color: '#ffe93d', glow: 14 });
      }
      let bx = x + 4, by = y + (mode_ === 2 ? 96 : 108);
      if (p.shield) { badge(bx, by, POW.shield.c, 'S'); bx += 32; }
      if (p.magnet > 0) { badge(bx, by, POW.magnet.c, 'M'); bx += 32; }
      if (p.mult > 0) { badge(bx, by, POW.mult.c, '2x'); bx += 32; }
      if (slowmo > 0) { badge(bx, by, POW.slowmo.c, 'T'); bx += 32; }
    });
    txt(Sfx.isMuted() ? 'SOUND OFF (M)' : 'SOUND ON (M)', W - 18, 20, { align: 'right', size: 12, color: 'rgba(255,255,255,0.55)' });
    // speed meter (top center)
    const sw = Math.min(260, W * 0.3), sx = W / 2 - sw / 2, sy = 16;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 4;
    line(sx, sy, sx + sw, sy);
    const frac = (speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED);
    const sg = ctx.createLinearGradient(sx, 0, sx + sw, 0);
    sg.addColorStop(0, COLORS.laneA); sg.addColorStop(1, COLORS.horizon);
    ctx.strokeStyle = sg; ctx.shadowColor = COLORS.horizon; ctx.shadowBlur = 10;
    line(sx, sy, sx + sw * clamp(frac, 0, 1), sy);
    ctx.restore();
    txt('SPEED', W / 2, 34, { size: 10, color: 'rgba(255,255,255,0.5)' });
  }

  function drawMenu() {
    // decorative scrolling grid
    drawGrid(H * 0.80, COLORS.laneA, 0, H, worldTime * 160);
    // title
    const t = 'NEON DASH';
    txt(t, W / 2, H * 0.24, { size: Math.min(96, W * 0.11), color: '#fff', glow: 40, glowColor: COLORS.horizon, spacing: 10 });
    txt('A  S Y N T H W A V E   R U N N E R', W / 2, H * 0.24 + Math.min(64, W * 0.07), { size: 16, color: COLORS.laneA, glow: 12, spacing: 4 });

    const cy = H * 0.5;
    txt('PRESS  1  FOR  SOLO', W / 2, cy - 10, { size: 30, color: COLORS.laneA, glow: 20 });
    txt('PRESS  2  FOR  TWO  PLAYERS', W / 2, cy + 40, { size: 30, color: COLORS.laneB, glow: 20 });

    // controls card
    const bw = Math.min(560, W * 0.8), bx = W / 2 - bw / 2, by = cy + 84;
    ctx.save();
    ctx.fillStyle = 'rgba(8,3,20,0.6)';
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
    roundRect(bx, by, bw, 128, 12); ctx.fill(); ctx.stroke();
    ctx.restore();
    const cx2 = bx + 24;
    txt('P1', cx2, by + 28, { align: 'left', size: 16, color: COLORS.laneA, glow: 8 });
    txt('W jump   ·   S slide', cx2 + 60, by + 28, { align: 'left', size: 15, color: 'rgba(255,255,255,0.8)' });
    txt('P2', cx2, by + 62, { align: 'left', size: 16, color: COLORS.laneB, glow: 8 });
    txt('↑ jump   ·   ↓ slide', cx2 + 60, by + 62, { align: 'left', size: 15, color: 'rgba(255,255,255,0.8)' });
    txt('Double-tap jump = double jump  ·  hold jump = higher  ·  M mute  ·  P pause', W / 2, by + 100, { size: 12, color: 'rgba(255,255,255,0.5)' });

    const blink = 0.5 + 0.5 * Math.sin(worldTime * 4);
    ctx.save(); ctx.globalAlpha = blink;
    txt('JUMP OVER BLOCKS  ·  SLIDE UNDER LASERS  ·  CHAIN ORBS', W / 2, H * 0.92, { size: 13, color: '#ffe93d', glow: 10, spacing: 2 });
    ctx.restore();
  }

  function drawCountdown() {
    ctx.save();
    ctx.fillStyle = 'rgba(5,1,15,0.35)';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    txt('GET READY', W / 2, H * 0.3, { size: 24, color: 'rgba(255,255,255,0.7)', spacing: 6 });
    const n = Math.ceil(countdownT);
    const frac = countdownT - Math.floor(countdownT);
    const scale = 1 + (1 - frac) * 0.5;
    const col = n === 1 ? '#ffe93d' : n === 2 ? COLORS.laneA : COLORS.laneB;
    txt(String(n), W / 2, H * 0.48, { size: 140 * scale, color: col, glow: 50 });
  }

  function drawGameOver() {
    ctx.save();
    ctx.fillStyle = 'rgba(5,1,15,0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    let title = 'GAME OVER';
    txt(title, W / 2, H * 0.20, { size: Math.min(68, W * 0.08), color: COLORS.horizon, glow: 34, spacing: 8 });

    if (mode_ === 2) {
      const w = lanes[0].player.score >= lanes[1].player.score ? 0 : 1;
      txt('P' + (w + 1) + '  WINS!', W / 2, H * 0.30, { size: 34, color: lanes[w].player.color, glow: 20 });
    }

    lanes.forEach((l, i) => {
      const p = l.player;
      const y = H * 0.44 + i * 64;
      txt('P' + (i + 1), W / 2 - 140, y, { align: 'right', size: 24, color: l.color, glow: 10 });
      txt(fmt(p.score), W / 2 + 20, y, { align: 'left', size: 34, color: '#fff', glow: 12, glowColor: l.color });
      const newBest = p.score > prevBests[i];
      txt(newBest ? 'NEW BEST!' : 'BEST ' + fmt(bests[i] || 0), W / 2 + 150, y, {
        align: 'left', size: 14, color: newBest ? '#ffe93d' : 'rgba(255,255,255,0.5)', glow: newBest ? 12 : 0,
      });
    });

    const blink = 0.5 + 0.5 * Math.sin(worldTime * 4);
    ctx.save(); ctx.globalAlpha = blink;
    txt('SPACE — RESTART      ·      M — MENU', W / 2, H * 0.78, { size: 18, color: '#fff', spacing: 2 });
    ctx.restore();
  }

  function drawPaused() {
    ctx.save();
    ctx.fillStyle = 'rgba(5,1,15,0.6)';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    txt('PAUSED', W / 2, H * 0.45, { size: 56, color: '#fff', glow: 30, spacing: 10 });
    txt('P to resume  ·  M to mute', W / 2, H * 0.45 + 52, { size: 16, color: 'rgba(255,255,255,0.7)' });
  }

  // ---------- main draw ----------
  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (shakeT > 0) {
      const s = shakeMag * (shakeT / 0.28);
      ctx.translate((Math.random() * 2 - 1) * s, (Math.random() * 2 - 1) * s);
    }
    drawBackground();
    if (state !== 'menu' && lanes) {
      for (const l of lanes) drawLane(l);
      if (mode_ === 2) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2;
        line(0, H * 0.5, W, H * 0.5);
        ctx.restore();
      }
      drawVignette();
    } else {
      drawMenu();
      drawVignette();
    }
    drawParticles();
    ctx.restore();

    // overlays (not shaken)
    if (state === 'playing' || state === 'paused' || state === 'gameover' || state === 'countdown') drawHUD();
    if (state === 'countdown') drawCountdown();
    if (state === 'gameover') drawGameOver();
    if (state === 'paused') drawPaused();
    if (goT > 0 && state === 'playing') {
      ctx.save();
      ctx.globalAlpha = clamp(goT / 0.7, 0, 1);
      txt('GO!', W / 2, H * 0.46, { size: 150, color: '#ffe93d', glow: 60 });
      ctx.restore();
    }
  }

  // ---------- loop ----------
  function loop(ts) {
    requestAnimationFrame(loop);
    if (!last) last = ts;
    let dt = (ts - last) / 1000;
    last = ts;
    if (dt > 0.05) dt = 0.05;
    worldTime += dt;
    update(dt);
    draw();
    justPressed.clear();
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(loop);
})();
