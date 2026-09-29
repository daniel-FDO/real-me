/* =====================================================================
   WELCOME PAGE (index.html): the falling-name physics scene.
   js/site.js mounts this when the welcome page is shown and calls the
   returned function to tear it down when you leave, so it can come and go
   without a page load. Master volume and the song live in js/site.js.
   ===================================================================== */
Site.define("welcome", function (root) {
  var life = new AbortController(),
    on = { signal: life.signal },
    alive = true;
  /* =====================================================================
     SOUND CONFIG: every tunable for the sound lives here.
     All sounds are synthesized live with the Web Audio API (no audio files).
     Nothing is created until Sound is pressed.
     Gains are linear (0..1). Times are in seconds. Pitches are in Hz.
     ===================================================================== */
  var SOUND = {
    sfx: 0.55, // UI / impact sounds, relative to master
    reverb: 0.1, // wet level of the very short "glass room" (0 = fully dry)
    reverbTime: 0.2, // length of that room's tail
    brightness: 1, // multiplies every filter cutoff: <1 darker, >1 more sparkle
    polyphony: 8, // max impact voices at once; extra hits steal the quietest or are dropped
    pitchJitter: 0.03, // random pitch variation per hit (0.03 = about ±50 cents)
    timeJitter: 0.006, // random start offset per hit, loosens up big piles
    pan: 0.65, // stereo width: 0 = mono, 1 = hard left/right at the screen edges
    minVel: 3, // collisions slower than this (px/frame) make no sound
    maxVel: 22, // collisions at or above this play at full loudness
    density: 0.18, // how much the level ducks when lots of hits land close together
    massCurve: 0.2, // how strongly pitch drops as bodies get heavier (0 = no effect)
    // one voice per kind of thing. pitch = base pitch for a body of `refMass`.
    // length = amp decay time. bright = lowpass cutoff at full velocity.
    // rate / burst = rate limit (hits per second, and how many may come at once).
    voices: {
      letter: {
        pitch: 360,
        length: 0.12,
        bright: 3200,
        gain: 0.5,
        refMass: 8,
        rate: 12,
        burst: 4,
      }, // low, solid "tock"
      pill: {
        pitch: 980,
        length: 0.055,
        bright: 5200,
        gain: 0.18,
        refMass: 12,
        rate: 8,
        burst: 3,
        step: 1.335,
        gap: 0.045,
      }, // mid "tick-tick" (step = second note ratio)
      shape: {
        pitch: 1750,
        length: 0.07,
        bright: 7000,
        gain: 0.22,
        refMass: 1.4,
        rate: 16,
        burst: 5,
      }, // high, light "pip"
    },
    rise: { from: 330, to: 1320, gain: 0.05, steps: 12 }, // hold-to-enter sweep: pitch range, level, number of ticks
    confirm: { notes: [1318.5, 1975.5], gain: 0.2 }, // enter chime (E6 then B6)
    whoosh: { gain: 0.1, length: 0.15 }, // gravity / rain / start-over air sweeps
  };

  var M = Matter,
    Engine = M.Engine,
    Bodies = M.Bodies,
    Body = M.Body,
    Composite = M.Composite,
    Constraint = M.Constraint,
    Query = M.Query,
    Events = M.Events,
    Sleeping = M.Sleeping;
  var cv = document.getElementById("c"),
    ctx = cv.getContext("2d");
  var site = document.getElementById("site");
  var RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var INK = [22, 22, 29],
    BLUE = [47, 75, 255],
    BG = [251, 251, 253];
  var COL = ["#ffd23f", "#2f4bff", "#ff7ab8", "#6df0c2"];
  // the words that fall in after your name. Change, add or remove any of them.
  // They are placed in this order; the ones that don't fit on a small screen are left out.
  var WORDS = [
    "designer",
    "developer",
    "motion",
    "AI",
    "curious",
    "still learning",
    "ideas",
    "playful",
    "details",
    "builder",
    "bold",
    "beyond the minimum",
    "outside the box",
    "website animation",
  ];
  var HOLD_START = 250,
    HOLD = 1100; // ms: a press shorter than HOLD_START is a tap
  var MODES = [
    // gravity modes, the button cycles through them
    { n: "Earth", g: 1.1 },
    { n: "Moon", g: 0.22 },
    { n: "Float", g: 0 },
    { n: "Up", g: -1.1 },
  ];

  var w, h, dpr, fs, pf, shapeR, maxShapes, maxTyped, floorY, ceilY, engine, floor, ceiling, mode, t0;
  var movers = [],
    trail = [],
    parts = [],
    spawnTimers = [];
  var drag = null,
    charge = null,
    entered = false,
    acc = 0,
    last = performance.now();
  var ptr = { x: 0, y: 0 },
    prev = { x: 0, y: 0 },
    lastTrail = { x: 0, y: 0 },
    seen = false;
  var ring = { on: false, x: 0, y: 0, r: 9 };
  var sp = { x: 0, y: 0, r: 240, px: 0, py: 0 }; // spotlight and parallax on the portrait

  var $ = function (id) {
    return document.getElementById(id);
  };
  var rand = function (a, b) {
    return a + Math.random() * (b - a);
  };
  var clamp = function (v, a, b) {
    return Math.max(a, Math.min(b, v));
  };
  var pick = function (arr) {
    return arr[(Math.random() * arr.length) | 0];
  };

  /* =====================================================================
     SOUND ENGINE: clean, glassy, iOS-style UI sounds (tunables in SOUND at the top).
 voice (sine partials + noise click) -> lowpass (filter env) -> amp env -> choke -> pan
   -> sfx bus -> compressor -> site soft limiter -> master -> speakers (js/site.js)
 sfx bus -> very short reverb -> compressor
     Every node a voice makes is disconnected as soon as the voice ends.
     ===================================================================== */
  var AC = null,
    sfxBus = null,
    busNodes = [],
    noiseBuf = null,
    audioOn = false,
    riser = null,
    pool = [], // voices currently sounding
    buckets = {}, // per-type rate limiter (token buckets)
    heat = 0, // leaky count of recent hits, used to duck big piles
    heatT = 0;

  // builds this page's sound bus on the shared AudioContext from js/site.js
  function setupAudio() {
    AC = Site.sound.context();
    if (!AC) return false;
    var i;
    var comp = AC.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;
    sfxBus = AC.createGain();
    sfxBus.gain.value = SOUND.sfx;
    var verb = AC.createConvolver(),
      vhp = AC.createBiquadFilter(),
      wet = AC.createGain();
    verb.buffer = makeRoom(SOUND.reverbTime);
    vhp.type = "highpass";
    vhp.frequency.value = 450; // keeps the room airy, never boomy
    wet.gain.value = SOUND.reverb;
    sfxBus.connect(comp);
    sfxBus.connect(vhp);
    vhp.connect(verb);
    verb.connect(wet);
    wet.connect(comp);
    comp.connect(Site.sound.output());
    busNodes = [sfxBus, vhp, verb, wet, comp];
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }
  // a tiny stereo room: softened noise with a fast exponential decay
  function makeRoom(sec) {
    var sr = AC.sampleRate,
      len = Math.max(1, (sec * sr) | 0),
      pre = (0.006 * sr) | 0,
      buf = AC.createBuffer(2, len + pre, sr);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c),
        y = 0;
      for (var i = 0; i < len; i++) {
        y += 0.45 * (Math.random() * 2 - 1 - y);
        d[pre + i] = y * Math.exp((-6.9 * i) / len);
      }
    }
    return buf;
  }

  // ---- voice pool ----
  function prune(now) {
    for (var i = pool.length - 1; i >= 0; i--)
      if (pool[i].end < now - 0.3) freeVoice(pool[i]); // safety net if an "ended" event never arrives
  }
  function freeVoice(v) {
    if (v.dead) return;
    v.dead = true;
    v.nodes.forEach(function (n) {
      try {
        n.disconnect();
      } catch (e) {}
    });
    v.nodes.length = 0;
    var i = pool.indexOf(v);
    if (i > -1) pool.splice(i, 1);
  }
  // fade a voice out over 6 ms (never a hard cut, so no click) and let it go
  function steal(v, t) {
    v.stolen = true;
    v.choke.gain.setValueAtTime(1, t);
    v.choke.gain.linearRampToValueAtTime(0, t + 0.006);
    v.srcs.forEach(function (s) {
      try {
        s.stop(t + 0.008);
      } catch (e) {}
    });
    v.end = Math.min(v.end, t + 0.01);
  }
  // returns a new voice, or null when the pool is full of louder voices.
  // ui voices (rise ticks, chimes, whooshes) always get through and do not count against polyphony.
  function allocate(t, level, pan, cutoff, length, ui) {
    prune(t);
    if (!ui) {
      var busy = pool.filter(function (v) {
        return !v.ui && !v.stolen;
      });
      if (busy.length >= SOUND.polyphony) {
        var q = busy.reduce(function (a, b) {
          return b.level < a.level ? b : a;
        });
        if (q.level >= level) return null;
        steal(q, AC.currentTime);
      }
    }
    var v = {
      nodes: [],
      srcs: [],
      live: 0,
      end: t + length,
      level: level,
      ui: !!ui,
    };
    var f = AC.createBiquadFilter(),
      a = AC.createGain(),
      ch = AC.createGain(),
      out = ch;
    // filter envelope: opens with the hit, closes as it decays
    var c = Math.min(cutoff * SOUND.brightness, AC.sampleRate * 0.45);
    f.type = "lowpass";
    f.Q.value = 0.6;
    f.frequency.setValueAtTime(c, t);
    f.frequency.exponentialRampToValueAtTime(
      Math.max(250, c * 0.3),
      t + length,
    );
    // amp envelope: 1.5 ms attack, open for the sound, 8 ms release (the partials shape the decay)
    a.gain.setValueAtTime(0, t);
    a.gain.linearRampToValueAtTime(level, t + 0.0015);
    a.gain.setValueAtTime(level, t + length);
    a.gain.linearRampToValueAtTime(0, t + length + 0.008);
    f.connect(a);
    a.connect(ch);
    v.nodes.push(f, a, ch);
    if (AC.createStereoPanner) {
      var p = AC.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      ch.connect(p);
      v.nodes.push(p);
      out = p;
    }
    out.connect(sfxBus);
    v.in = f;
    v.choke = ch;
    v.end = t + length + 0.012;
    pool.push(v);
    return v;
  }
  function track(v, src, t, stopAt, extra) {
    v.srcs.push(src);
    v.nodes.push(src);
    extra.forEach(function (n) {
      v.nodes.push(n);
    });
    v.live++;
    src.onended = function () {
      if (--v.live <= 0) freeVoice(v);
    };
    src.stop(Math.min(stopAt, v.end));
  }
  // one sine partial: fast exponential pitch glide f0 -> f1, then its own exponential decay
  function partial(v, t, f0, f1, glide, peak, decay) {
    var o = AC.createOscillator(),
      g = AC.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + glide);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.001);
    g.gain.exponentialRampToValueAtTime(peak * 0.0005, t + decay);
    g.gain.linearRampToValueAtTime(0, t + decay + 0.003);
    o.connect(g);
    g.connect(v.in);
    o.start(t);
    track(v, o, t, t + decay + 0.005, [g]);
  }
  // band-passed noise transient, well under 5 ms: the crisp "click" at the front of a sound
  function click(v, t, fc, q, peak, len) {
    var s = AC.createBufferSource(),
      f = AC.createBiquadFilter(),
      g = AC.createGain();
    s.buffer = noiseBuf;
    f.type = "bandpass";
    f.frequency.value = Math.min(
      fc * SOUND.brightness,
      AC.sampleRate * 0.45,
    );
    f.Q.value = q;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.0004);
    g.gain.exponentialRampToValueAtTime(peak * 0.002, t + len);
    g.gain.linearRampToValueAtTime(0, t + len + 0.001);
    s.connect(f);
    f.connect(g);
    g.connect(v.in);
    s.start(t, Math.random() * 0.9);
    track(v, s, t, t + len + 0.003, [f, g]);
  }

  // ---- the three impact voices. f = pitch, b = brightness 0..1 from the hit's speed ----
  var BUILD = {
    letter: function (v, t, f, b, c) {
      // "tock": the body drops fast into its note, a glassy overtone, a hint of sparkle
      partial(v, t, f * 1.9, f, 0.014, 1, c.length);
      partial(v, t, f * 3.4, f * 2.76, 0.01, 0.2, 0.035);
      partial(v, t, f * 5.4, f * 5.4, 0.01, 0.05 + 0.07 * b, 0.016);
      click(v, t, 2600, 0.8, 0.3 + 0.3 * b, 0.004);
    },
    pill: function (v, t, f, b, c) {
      // "tick-tick": two short glassy ticks, the second a step higher and a little softer
      for (var k = 0; k < 2; k++) {
        var tt = t + k * c.gap,
          ff = f * (k ? c.step : 1),
          a = k ? 0.72 : 1;
        partial(v, tt, ff * 1.4, ff, 0.009, a, c.length);
        partial(v, tt, ff * 2.76, ff * 2.76, 0.01, 0.16 * a, 0.022);
        click(v, tt, 4200, 1, (0.22 + 0.22 * b) * a, 0.003);
      }
    },
    shape: function (v, t, f, b, c) {
      // "pip": a quick upward flick, light and airy
      partial(v, t, f * 0.78, f, 0.012, 1, c.length);
      partial(v, t, f * 2, f * 2.01, 0.012, 0.1, 0.022);
      partial(v, t, f * 3.1, f * 3.1, 0.01, 0.04 + 0.05 * b, 0.012);
      click(v, t, 6500, 1.2, 0.16 + 0.18 * b, 0.0025);
    },
  };
  // token bucket per type: at most `burst` at once, refilling at `rate` per second
  function allow(type, now) {
    var c = SOUND.voices[type],
      k = buckets[type] || (buckets[type] = { n: c.burst, t: now });
    k.n = Math.min(c.burst, k.n + (now - k.t) * c.rate);
    k.t = now;
    if (k.n < 1) return false;
    k.n--;
    return true;
  }
  // play a body's voice. vel = impact speed (px per frame). force skips the rate limit (taps).
  function hit(body, vel, force) {
    if (!audioOn || !AC || !body || !SOUND.voices[body.kind]) return;
    var type = body.kind,
      c = SOUND.voices[type],
      now = AC.currentTime;
    if (!force && !allow(type, now)) return;
    var v01 = clamp(
      (vel - SOUND.minVel) / (SOUND.maxVel - SOUND.minVel),
      0,
      1,
    );
    heat = heat * Math.exp(-(now - heatT) / 0.25) + 1;
    heatT = now;
    var level =
      (c.gain * (0.12 + 0.88 * Math.pow(v01, 1.4))) /
      (1 + SOUND.density * (heat - 1));
    // heavier and bigger bodies sound lower
    var f =
      c.pitch *
      clamp(
        Math.pow(c.refMass / Math.max(0.05, body.mass), SOUND.massCurve),
        0.6,
        1.7,
      ) *
      (1 + rand(-SOUND.pitchJitter, SOUND.pitchJitter));
    var t = now + 0.004 + Math.random() * SOUND.timeJitter;
    var len = type === "pill" ? c.gap + c.length : c.length;
    var v = allocate(
      t,
      level,
      (body.position.x / w - 0.5) * 2 * SOUND.pan,
      c.bright * (0.35 + 0.65 * v01),
      len,
    );
    if (v) BUILD[type](v, t, f, v01, c);
  }
  // a short glassy chime: notes played one after another (confirm, sound on / off)
  function chime(notes, gain, pan) {
    if (!audioOn || !AC) return;
    notes.forEach(function (f, i) {
      var t = AC.currentTime + 0.004 + i * 0.07,
        v = allocate(t, gain * (i ? 0.8 : 1), pan || 0, 9000, 0.14, true);
      partial(v, t, f * 1.25, f, 0.01, 1, 0.14);
      partial(v, t, f * 2.76, f * 2.76, 0.01, 0.12, 0.05);
      partial(v, t, f * 2, f * 2, 0.01, 0.1, 0.08);
      click(v, t, 6000, 1, 0.18, 0.003);
    });
  }
  function confirmChime() {
    chime(SOUND.confirm.notes, SOUND.confirm.gain);
    whoosh(true, 0.7);
  }
  // a crisp swish of filtered air with a faint digital glide under it
  function whoosh(rising, amt) {
    if (!audioOn || !AC) return;
    var W = SOUND.whoosh,
      L = W.length,
      g0 = W.gain * (amt || 1),
      t = AC.currentTime + 0.004,
      v = allocate(t, 1, 0, 12000, L, true),
      s = AC.createBufferSource(),
      hp = AC.createBiquadFilter(),
      bp = AC.createBiquadFilter(),
      g = AC.createGain(),
      lo = rising ? 700 : 5200,
      hi = rising ? 5200 : 700;
    s.buffer = noiseBuf;
    hp.type = "highpass";
    hp.frequency.value = 400;
    bp.type = "bandpass";
    bp.Q.value = 1.3;
    bp.frequency.setValueAtTime(lo, t);
    bp.frequency.exponentialRampToValueAtTime(hi, t + L * 0.9);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(g0, t + L * 0.35);
    g.gain.exponentialRampToValueAtTime(g0 * 0.002, t + L);
    g.gain.linearRampToValueAtTime(0, t + L + 0.004);
    s.connect(hp);
    hp.connect(bp);
    bp.connect(g);
    g.connect(v.in);
    s.start(t, Math.random() * 0.6);
    track(v, s, t, t + L + 0.006, [hp, bp, g]);
    partial(
      v,
      t,
      rising ? 520 : 1400,
      rising ? 1400 : 520,
      L * 0.8,
      g0 * 0.25,
      L,
    );
  }
  // hold to enter: a soft digital sweep that follows the charge, with quantized ticks like a picker wheel
  function riseUpdate(c) {
    if (!audioOn || !AC) return;
    var R = SOUND.rise,
      t = AC.currentTime;
    if (!riser) {
      var o = AC.createOscillator(),
        o2 = AC.createOscillator(),
        g2 = AC.createGain(),
        f = AC.createBiquadFilter(),
        g = AC.createGain(),
        out = g;
      o.type = o2.type = "sine";
      o.frequency.value = R.from;
      o2.frequency.value = R.from * 2.004; // a slightly detuned octave for a glassy shimmer
      g2.gain.value = 0.22;
      f.type = "lowpass";
      f.Q.value = 1.8;
      f.frequency.value = 900;
      g.gain.setValueAtTime(0, t);
      o.connect(f);
      o2.connect(g2);
      g2.connect(f);
      f.connect(g);
      if (AC.createStereoPanner) {
        out = AC.createStereoPanner();
        g.connect(out);
      }
      out.connect(sfxBus);
      o.start(t);
      o2.start(t);
      riser = {
        o: o,
        o2: o2,
        f: f,
        g: g,
        step: 0,
        nodes: [o, o2, g2, f, g, out],
      };
    }
    var fr = R.from * Math.pow(R.to / R.from, c);
    riser.o.frequency.setTargetAtTime(fr, t, 0.03);
    riser.o2.frequency.setTargetAtTime(fr * 2.004, t, 0.03);
    riser.f.frequency.setTargetAtTime(
      Math.min(fr * 3 * SOUND.brightness, 14000),
      t,
      0.03,
    );
    riser.g.gain.setTargetAtTime(R.gain * (0.25 + 0.75 * c), t, 0.04);
    var s = Math.floor(c * R.steps);
    if (s > riser.step) {
      riser.step = s;
      var tt = t + 0.004,
        v = allocate(
          tt,
          0.1 + 0.12 * c,
          charge ? (charge.x / w - 0.5) * SOUND.pan : 0,
          9000,
          0.05,
          true,
        );
      partial(v, tt, fr * 2.4, fr * 2, 0.006, 1, 0.045);
      click(v, tt, 5000, 1, 0.15, 0.002);
    }
  }
  function riseStop() {
    if (!riser || !AC) return;
    var r = riser,
      t = AC.currentTime;
    riser = null;
    r.g.gain.cancelScheduledValues(t);
    r.g.gain.setTargetAtTime(0, t, 0.025);
    r.o.onended = function () {
      r.nodes.forEach(function (n) {
        n.disconnect();
      });
    };
    r.o.stop(t + 0.2);
    r.o2.stop(t + 0.2);
  }

  // ---- sound on / off comes from the shared Sound button (js/site.js) ----
  function soundChanged(on) {
    if (!AC && !setupAudio()) return;
    if (on) {
      audioOn = true;
      chime([1046.5, 1568], 0.14);
    } else {
      chime([1568, 1046.5], 0.12); // a soft step down as it switches off
      audioOn = false;
      riseStop();
    }
  }
  Site.on(
    "sound",
    function (e) {
      soundChanged(e.detail.on);
    },
    life.signal,
  );
  if (Site.sound.isOn() && setupAudio()) audioOn = true; // arriving here with sound already on
  document.addEventListener(
    "visibilitychange",
    function () {
      if (document.hidden) riseStop();
    },
    on,
  );

  /* =====================================================================
     BUTTONS
     ===================================================================== */
  function ready() {
    return !entered && performance.now() - t0 > 1200;
  }
  function spawnY() {
    return mode === 0
      ? -80
      : rand(ceilY + 130, Math.max(ceilY + 200, h * 0.5));
  }

  $("grav").addEventListener(
    "click",
    function () {
      if (!ready()) return;
      mode = (mode + 1) % MODES.length;
      engine.gravity.y = MODES[mode].g;
      // resting bodies may sleep, except in Float where everything keeps drifting
      engine.enableSleeping = MODES[mode].g !== 0;
      wakeAll();
      if (mode > 0) {
        // in every mode except Earth the top of the screen is a solid ceiling
        movers.forEach(function (b) {
          if (b.position.y < ceilY + 120)
            Body.setPosition(b, { x: b.position.x, y: ceilY + 120 });
        });
        if (!Composite.allBodies(engine.world).includes(ceiling))
          Composite.add(engine.world, ceiling);
      } else Composite.remove(engine.world, ceiling);
      movers.forEach(function (b) {
        Body.setAngularVelocity(b, rand(-0.12, 0.12));
      });
      this.querySelector(".val").textContent = MODES[mode].n;
      whoosh(MODES[mode].g <= 0.22);
    },
    on,
  );
  $("rain").addEventListener(
    "click",
    function () {
      if (entered) return;
      var n = Math.min(12, Math.ceil(maxShapes * 0.5));
      for (var i = 0; i < n; i++)
        spawnShape(
          rand(30, w - 30),
          mode === 0 ? -rand(20, 900) : spawnY(),
          true,
        );
      whoosh(false);
    },
    on,
  );
  // keyboard (and screen reader) buttons for the tech objects: act on one that is already on screen,
  // or drop one in first. They never start the hold-to-enter charge.
  document.querySelectorAll("[data-tech]").forEach(function (btn) {
    btn.addEventListener(
      "click",
      function () {
        if (entered || !engine) return;
        var type = btn.dataset.tech,
          b = movers.filter(function (m) {
            return m.tech === type;
          })[0];
        if (!b) {
          spawnShape(w * 0.5, mode === 0 ? -60 : spawnY(), true, type);
          b = movers[movers.length - 1];
        }
        wake(b);
        techTap(b);
        hit(b, 12, true);
      },
      on,
    );
  });
  $("reset").addEventListener(
    "click",
    function () {
      if (!entered) {
        init();
        whoosh(false);
      }
    },
    on,
  );

  // theme colours for the canvas, read from the CSS tokens in css/site.css
  function rgb(hex, fallback) {
    var m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
    if (!m) return fallback;
    var n = parseInt(m[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    INK = rgb(cs.getPropertyValue("--ink"), INK);
    BLUE = rgb(cs.getPropertyValue("--blue"), BLUE);
    BG = rgb(cs.getPropertyValue("--bg"), BG);
    CHIP = BG[0] + BG[1] + BG[2] < 300 ? "#454a60" : "#262833";
  }
  Site.on("theme", readColors, life.signal);
  function rgba(c, a) {
    return "rgba(" + c.join(",") + "," + a + ")";
  }
  // wake a body; a word that is still falling in also gets its normal spin back
  function wake(b) {
    Sleeping.set(b, false);
    unlockSpin(b);
  }
  function unlockSpin(b) {
    if (b.inertia0) {
      Body.setInertia(b, b.inertia0);
      b.inertia0 = 0;
    }
  }
  function wakeAll() {
    movers.forEach(function (b) {
      wake(b);
    });
  }

  /* =====================================================================
     SCENE
     ===================================================================== */
  function init() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = innerWidth;
    h = innerHeight;
    cv.width = w * dpr;
    cv.height = h * dpr;
    readColors();
    // everything scales from the smaller side of the window, so short or narrow windows
    // get a smaller name, smaller words and fewer of them, and the pile always stays low
    var m = Math.min(w, h);
    fs = clamp(Math.min(m * 0.27, w * 0.19), 56, 230);
    pf = clamp(m * 0.03, 13, 24);
    shapeR = clamp(m * 0.036, 11, 30);
    maxShapes = clamp(Math.round((w * h) / 30000), 10, 30); // hard caps: the oldest go first (tech objects are bigger than the old shapes)
    maxTyped = clamp(Math.round((w * h) / 40000), 8, 24);
    // sleeping lets settled bodies rest completely instead of jittering or balancing
    engine = Engine.create({
      enableSleeping: true,
      positionIterations: 10,
      velocityIterations: 8,
    });
    mode = 0;
    engine.gravity.y = MODES[0].g;
    t0 = performance.now();
    $("grav").querySelector(".val").textContent = "Earth";
    drag = null;
    charge = null;
    trail = [];
    parts = [];
    movers = [];
    riseStop();

    // the floor is the bottom edge of the screen (things rest behind the hold pill).
    // In the other gravity modes the ceiling is the top edge, behind the top bar.
    ceilY = 0;
    floorY = h;
    // on narrow portrait screens the hold pill would cover the whole pile, so it sits under the top bar instead
    var up = w <= 760 && h > w;
    guideEl.classList.toggle("up", up);
    guideEl.style.top = up ? document.querySelector(".top").getBoundingClientRect().bottom + 8 + "px" : "";
    var t = 400; // thick walls, so nothing can tunnel through at speed
    ceiling = Bodies.rectangle(w / 2, ceilY - t / 2, w * 3, t, {
      isStatic: true,
    });
    floor = Bodies.rectangle(w / 2, floorY + t / 2, w * 3, t, {
      isStatic: true,
    });
    Composite.add(engine.world, [
      floor,
      Bodies.rectangle(-t / 2, -h * 3, t, h * 8, { isStatic: true }),
      Bodies.rectangle(w + t / 2, -h * 3, t, h * 8, { isStatic: true }),
    ]);

    // the name: one physics body per letter, sized from the real letter width
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = fs + 'px "Instrument Serif", Georgia, serif';
    var word = "DANIEL".split("");
    var ws = word.map(function (c) {
      return ctx.measureText(c).width * 0.92;
    });
    var total = ws.reduce(function (a, b) {
      return a + b;
    }, 0);
    var x = (w - total) / 2;
    var letters = word.map(function (c, i) {
      var b = Bodies.rectangle(
        x + ws[i] / 2,
        RM ? floorY - fs * 0.36 : -fs * (1 + i * 0.8),
        ws[i],
        fs * 0.72,
        {
          chamfer: { radius: 8 },
          restitution: 0.35,
          friction: 0.4,
          frictionAir: 0.02,
          density: 0.0012,
          angle: RM ? 0 : (Math.random() - 0.5) * 0.8,
        },
      );
      b.kind = "letter";
      b.ch = c;
      b.hot = 0;
      b.base = 0;
      b.fsz = fs;
      x += ws[i];
      return b;
    });

    movers = letters;
    Composite.add(engine.world, movers);

    // the words: packed in rows on the free ground either side of the name, from the
    // screen edges inwards, so the pile stays low and never rests on the letters. A row
    // only reaches as far as the row under it, so every word lands on the ground or on
    // another word. Words that don't fit on this screen are left out.
    spawnTimers.forEach(clearTimeout);
    spawnTimers = [];
    var ph = pf * 2.1,
      space = pf * 0.4,
      edge = 8,
      gap = fs * 0.3 + pf * 0.5, // room for the letters to tumble without touching the words
      rows = clamp(Math.floor((h * 0.28) / ph), 1, 3);
    var lanes = [
      { from: edge, dir: 1 }, // left side, filling rightwards
      { from: w - edge, dir: -1 }, // right side, filling leftwards
    ];
    lanes.forEach(function (l) {
      l.size = (w - total) / 2 - gap - edge;
      l.used = [];
      for (var r = 0; r < rows; r++) l.used.push(0);
    });
    ctx.font = "700 " + pf + 'px "DM Sans", system-ui, sans-serif';
    var drops = [];
    WORDS.forEach(function (txt, i) {
      var pw = ctx.measureText(txt).width + pf * 1.8;
      for (var r = 0; r < rows; r++) {
        // the side with the most room on this row goes first, so both sides fill evenly
        var best = null;
        lanes.forEach(function (l) {
          var room =
            (r ? l.used[r - 1] : l.size) -
            l.used[r] -
            (l.used[r] ? space : 0);
          if (room >= pw && (!best || room > best.room))
            best = { l: l, room: room };
        });
        if (best) {
          var l = best.l,
            start = l.used[r] + (l.used[r] ? space : 0);
          l.used[r] = start + pw;
          drops.push({
            txt: txt,
            i: i,
            pw: pw,
            ph: ph,
            row: r,
            x: l.from + l.dir * (start + pw / 2),
          });
          return;
        }
      }
    });
    // the bottom row lands first, then the rows above it
    drops.sort(function (a, b) {
      return a.row - b.row;
    });
    drops.forEach(function (d, k) {
      spawnTimers.push(
        setTimeout(
          function () {
            spawnPill(d);
          },
          RM ? 0 : 900 + k * 140,
        ),
      );
    });
    // a few tech objects tumble in at the edges once the words have landed, one after another,
    // so the terminal, chip, keys and browser are there to play with (skipped with reduced motion)
    if (!RM)
      ["terminal", "chip", "enter", "browser", "esc"].forEach(function (type, k) {
        spawnTimers.push(
          setTimeout(function () {
            // released just above the pile (not from the top of the screen), so they settle gently
            // instead of knocking the words onto the letters
            if (!entered && mode === 0) spawnShape(w * [0.08, 0.92, 0.2, 0.8, 0.3][k], h - Math.min(h * 0.4, rows * ph + 150), true, type);
          }, 1300 + drops.length * 140 + k * 650),
        );
      });

    // impacts: every hit plays its body's voice (letters tock, pills tick-tick, shapes pip), the harder ones also puff a little dust
    Events.on(engine, "collisionStart", function (ev) {
      ev.pairs.forEach(function (p) {
        var a = p.bodyA,
          b = p.bodyB;
        var rv = Math.hypot(
          a.velocity.x - b.velocity.x,
          a.velocity.y - b.velocity.y,
        );
        if (rv < 3) return;
        if (rv >= SOUND.minVel)
          // the faster of the two moving bodies makes the sound
          hit(
            a.isStatic ? b : b.isStatic || a.speed >= b.speed ? a : b,
            rv,
          );
        var s = p.collision.supports[0];
        if (s && rv > 5 && !RM && parts.length < 300) {
          for (var i = 0; i < 4; i++)
            parts.push({
              x: s.x,
              y: s.y,
              vx: rand(-2.5, 2.5),
              vy: rand(-3, -0.4),
              s: rand(4, 9),
              c: "#c9cbe0",
              life: 0.7,
            });
        }
      });
    });
  }
  // a small change in height (a phone's toolbar or keyboard) just moves the floor
  function fitHeight() {
    h = innerHeight;
    cv.height = h * dpr;
    floorY = h;
    Body.setPosition(floor, { x: w / 2, y: floorY + 200 });
    wakeAll();
  }

  function spawnPill(d) {
    if (entered || !alive) return;
    var b = Bodies.rectangle(
      d.x,
      RM ? floorY - d.ph * (d.row + 0.5) : mode === 0 ? -d.ph * 1.5 : spawnY(),
      d.pw,
      d.ph,
      {
        chamfer: { radius: d.ph / 2 - 1 },
        restitution: 0.15,
        friction: 0.5,
        frictionAir: 0.02,
        density: 0.001,
        angle: RM ? 0 : rand(-0.08, 0.08),
      },
    );
    b.kind = "pill";
    b.txt = d.txt;
    b.col = COL[d.i % 4];
    b.pw = d.pw;
    b.ph = d.ph;
    // words fall in without spinning, so they land flat instead of on their ends.
    // They get their normal spin back once they settle, or as soon as you touch them.
    b.inertia0 = b.inertia;
    Body.setInertia(b, Infinity);
    Events.on(b, "sleepStart", function () {
      unlockSpin(b);
    });
    movers.push(b);
    Composite.add(engine.world, b);
  }

  /* =====================================================================
     TECH OBJECTS: little IT things that fall instead of plain shapes.
     Each one is drawn from SVG path data (Path2D) in a ~100-unit design box
     centred on 0,0, in the site palette with a dark sticker outline. Its
     physics body is a matching rounded rectangle, or for the mouse pointer a
     convex outline, so it tumbles, stacks and drags like the real thing.
     ===================================================================== */
  var OUTLINE = "#16161d",
    SCREEN = "#16161d",
    CHIP = "#262833"; // lifted a little in dark mode (see readColors) so it doesn't vanish into the background
  function rr(x, y, w, h, r) {
    // an SVG rounded-rectangle path
    return (
      "M" + (x + r) + " " + y + "h" + (w - 2 * r) + "a" + r + " " + r + " 0 0 1 " + r + " " + r +
      "v" + (h - 2 * r) + "a" + r + " " + r + " 0 0 1 " + -r + " " + r +
      "h" + -(w - 2 * r) + "a" + r + " " + r + " 0 0 1 " + -r + " " + -r +
      "v" + -(h - 2 * r) + "a" + r + " " + r + " 0 0 1 " + r + " " + -r + "z"
    );
  }
  var pathCache = {};
  function P2(d) {
    return pathCache[d] || (pathCache[d] = new Path2D(d));
  }
  function shade(d, fill, stroke, lw) {
    var p = P2(d);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill(p);
    }
    if (stroke) {
      ctx.lineWidth = lw || 2.6;
      ctx.strokeStyle = stroke;
      ctx.stroke(p);
    }
  }
  function lighten(hex, k) {
    var n = parseInt(hex.slice(1), 16),
      c = [n >> 16, (n >> 8) & 255, n & 255].map(function (v) {
        return Math.round(v + (255 - v) * k);
      });
    return "rgb(" + c.join(",") + ")";
  }
  // a code glyph drawn as a thick rounded stroke with an outline, like a sticker
  function glyph(d, col) {
    ctx.lineCap = ctx.lineJoin = "round";
    shade(d, null, OUTLINE, 17);
    shade(d, null, col, 10.5);
  }
  function label(txt, size, col, y) {
    ctx.font = "700 " + size + 'px "DM Sans", system-ui, sans-serif';
    ctx.fillStyle = col;
    ctx.fillText(txt, 0, y);
  }
  // w/h/r = collision box in design units; size = scale relative to the others; weight = how often it appears
  var TECH = {
    laptop: {
      w: 96, h: 64, r: 8, size: 1, weight: 3,
      draw: function (c) {
        ctx.translate(0, 1);
        shade(rr(-40, -33, 80, 53, 6), c, OUTLINE);
        shade(rr(-34, -27, 68, 41, 3), SCREEN);
        shade(rr(-28, -21, 24, 4, 2), "#6df0c2");
        shade(rr(-28, -13, 36, 4, 2), "#ff7ab8");
        shade(rr(-22, -5, 28, 4, 2), "#ffd23f");
        shade(rr(-28, 3, 18, 4, 2), "#8b95ff");
        shade("M-48 26 L-42 20 H42 L48 26 A3 3 0 0 1 45 30 H-45 A3 3 0 0 1 -48 26 Z", "#f4f4f7", OUTLINE);
        shade(rr(-8, 20, 16, 3, 1.5), "#c9cbe0");
      },
    },
    chip: {
      w: 64, h: 64, r: 8, size: 0.8, weight: 3,
      // circuit traces from the die out to the pins. Signals run along them now and then,
      // and they light up while you hover (or after a tap)
      traces: ["M-14 -6 H-20 V-18", "M-14 6 H-22", "M14 -8 H20 V-18", "M14 6 H18 V18", "M-6 14 V20 H-18", "M6 -14 V-22"],
      draw: function (c, b) {
        [-18, -6, 6, 18].forEach(function (p) {
          shade(rr(p - 3, -36, 6, 11, 1.5), "#c9cbe0", OUTLINE, 2);
          shade(rr(p - 3, 25, 6, 11, 1.5), "#c9cbe0", OUTLINE, 2);
          shade(rr(-36, p - 3, 11, 6, 1.5), "#c9cbe0", OUTLINE, 2);
          shade(rr(25, p - 3, 11, 6, 1.5), "#c9cbe0", OUTLINE, 2);
        });
        shade(rr(-27, -27, 54, 54, 7), CHIP, OUTLINE);
        var lit = b === hoverBody || b.litUntil > frameNow;
        ctx.lineCap = ctx.lineJoin = "round";
        // a pulse every few seconds, offset per chip so they don't fire together
        var cycle = (frameNow + b.seed * 3000) % 4200,
          pulse = RM ? -1 : cycle / 900;
        this.traces.forEach(function (d) {
          if (lit) {
            ctx.shadowColor = c;
            ctx.shadowBlur = 6;
          }
          shade(d, null, lit ? c : "#6b6f85", 2.2);
          ctx.shadowBlur = 0;
          if (pulse >= 0 && pulse <= 1 && !lit) {
            // a short bright dash travelling outwards along the trace
            ctx.setLineDash([4, 60]);
            ctx.lineDashOffset = 4 - pulse * 30;
            shade(d, null, c, 2.6);
            ctx.setLineDash([]);
          }
        });
        shade(rr(-14, -14, 28, 28, 4), c, OUTLINE, 2);
        shade("M-7 -2h14M-7 4h9", null, OUTLINE, 2);
        ctx.beginPath();
        ctx.arc(-19, -19, 2.6, 0, 6.283);
        ctx.fillStyle = "#c9cbe0";
        ctx.fill();
      },
    },
    esc: {
      w: 62, h: 62, r: 11, size: 0.72, weight: 2,
      draw: function (c, b) {
        var k = springOf(b);
        shade(rr(-31, -31, 62, 62, 11), c, OUTLINE);
        ctx.translate(0, k * 5);
        shade(rr(-24, -27, 48, 44, 8), lighten(c, 0.5));
        label("esc", 17, OUTLINE, 1);
      },
    },
    enter: {
      w: 104, h: 62, r: 11, size: 0.82, weight: 2,
      // tap it and the key cap springs down and back up
      draw: function (c, b) {
        var k = springOf(b);
        shade(rr(-52, -31, 104, 62, 11), c, OUTLINE);
        ctx.translate(0, k * 6);
        ctx.scale(1 - k * 0.03, 1 - k * 0.03);
        shade(rr(-45, -27, 90, 44, 8), lighten(c, 0.5));
        label("Enter", 17, OUTLINE, 1);
        ctx.lineCap = ctx.lineJoin = "round";
        shade("M34 -12 V-2 H22 M26 -6 L22 -2 L26 2", null, OUTLINE, 2.4);
      },
    },
    pointer: {
      // a convex outline hugging the arrow, so it can lean and slide on its side
      hull: [[-14, -24], [-14, 16], [3, 22], [10, 19], [16, 4]],
      size: 0.95, weight: 3,
      draw: function (c) {
        shade("M-14 -24 L-14 16 L-4 7 L3 22 L10 19 L3 4 L16 4 Z", c === "#ffd23f" ? "#ffffff" : c, OUTLINE, 3);
      },
    },
    terminal: {
      w: 104, h: 72, r: 9, size: 0.95, weight: 2,
      // it types a short snippet, holds it, then moves on to the next. Tap it to replay.
      snippets: [
        ["$ npm run dev", "ready on :3000"],
        ["$ git push", "main -> origin"],
        ["$ node hello.js", "hello, world"],
        ["<h1>dF.</h1>", "</> styled"],
      ],
      draw: function (c, b) {
        shade(rr(-52, -36, 104, 72, 9), SCREEN, c, 3.4);
        shade("M-50 -24 V-27 A7 7 0 0 1 -43 -34 H43 A7 7 0 0 1 50 -27 V-24 Z", "#2a2c38");
        [["#ff7ab8", -41], ["#ffd23f", -33], ["#6df0c2", -25]].forEach(function (d) {
          ctx.beginPath();
          ctx.arc(d[1], -29, 2.6, 0, 6.283);
          ctx.fillStyle = d[0];
          ctx.fill();
        });
        var lines = this.snippets[b.snip % this.snippets.length],
          total = lines[0].length + lines[1].length,
          n = RM ? total : Math.max(0, Math.floor((frameNow - b.typeT) / 65));
        if (n > total + 60) {
          // held long enough: next snippet
          b.snip++;
          b.typeT = frameNow;
          n = 0;
        }
        ctx.textAlign = "left";
        ctx.font = "700 11px ui-monospace, Menlo, Consolas, monospace";
        var l1 = lines[0].slice(0, Math.min(n, lines[0].length)),
          l2 = lines[1].slice(0, Math.max(0, n - lines[0].length));
        ctx.fillStyle = "#6df0c2";
        ctx.fillText(l1, -42, -6);
        ctx.fillStyle = "#e8e9f3";
        ctx.fillText(l2, -42, 10);
        // blinking caret at the end of what has been typed
        if (Math.floor(frameNow / 450) % 2 === 0) {
          var onFirst = n <= lines[0].length,
            x = -42 + ctx.measureText(onFirst ? l1 : l2).width + 1;
          ctx.fillStyle = c;
          ctx.fillRect(x, onFirst ? -15 : 1, 6, 11);
        }
        ctx.textAlign = "center";
        shade(rr(-42, 22, 30, 3.5, 1.75), "#5d6078");
      },
    },
    browser: {
      w: 112, h: 78, r: 8, size: 1, weight: 2,
      // a wireframe web page that draws itself line by line, holds, then redraws
      parts: [
        { d: rr(-54, -37, 108, 74, 8), len: 360 },
        { d: "M-54 -23 H54", len: 108 },
        { d: rr(-44, -14, 46, 9, 3), len: 110 },
        { d: "M-44 4 H8 M-44 12 H-2", len: 100 },
        { d: rr(16, -14, 30, 30, 4), len: 120 },
        { d: "M16 -14 L46 16 M46 -14 L16 16", len: 85 },
        { d: rr(-44, 21, 30, 10, 5), len: 76 },
      ],
      draw: function (c, b) {
        var t = RM ? 1e9 : (frameNow - b.born + b.seed * 4000) % 11000,
          prog = Math.min(1, t / 3200), // drawing takes 3.2s
          fade = t > 9800 ? 1 - (t - 9800) / 1200 : 1;
        shade(rr(-54, -37, 108, 74, 8), "#ffffff", OUTLINE, 3.4); // the page itself is always there
        [["#ff7ab8", -46], ["#ffd23f", -39], ["#6df0c2", -32]].forEach(function (d) {
          ctx.beginPath();
          ctx.arc(d[1], -30, 2.3, 0, 6.283);
          ctx.fillStyle = d[0];
          ctx.fill();
        });
        ctx.lineCap = ctx.lineJoin = "round";
        ctx.globalAlpha *= fade;
        var n = this.parts.length;
        this.parts.forEach(function (p, i) {
          var local = Math.max(0, Math.min(1, prog * n - i));
          if (!local) return;
          ctx.setLineDash([p.len, p.len]);
          ctx.lineDashOffset = p.len * (1 - local);
          shade(p.d, null, i ? c : "#9aa0b8", i ? 2.4 : 2);
        });
        ctx.setLineDash([]);
      },
    },
    tag: {
      w: 96, h: 62, r: 24, size: 0.82, weight: 2,
      draw: function (c) {
        glyph("M-24 -20 L-42 0 L-24 20 M9 -26 L-9 26 M24 -20 L42 0 L24 20", c);
      },
    },
    braces: {
      w: 76, h: 70, r: 20, size: 0.78, weight: 2,
      draw: function (c) {
        glyph(
          "M-12 -32 C-22 -32 -24 -28 -24 -20 V-8 C-24 -2 -28 0 -34 0 C-28 0 -24 2 -24 8 V20 C-24 28 -22 32 -12 32" +
            "M12 -32 C22 -32 24 -28 24 -20 V-8 C24 -2 28 0 34 0 C28 0 24 2 24 8 V20 C24 28 22 32 12 32",
          c,
        );
      },
    },
  };
  // a damped spring for key presses: 1 = fully pressed, settling back to 0 with a little bounce
  function springOf(b) {
    if (!b.springT || RM) return 0;
    var t = (frameNow - b.springT) / 1000;
    if (t > 1.2) return 0;
    return Math.exp(-t * 6) * Math.cos(t * 22);
  }
  // what tapping an object does, on top of the usual hop: replay, spring or light up
  function techTap(b) {
    if (b.tech === "terminal") b.typeT = frameNow;
    else if (b.tech === "enter" || b.tech === "esc") b.springT = frameNow;
    else if (b.tech === "chip") b.litUntil = frameNow + 1600;
    else if (b.tech === "browser") b.born = frameNow - b.seed * 4000; // start drawing again
  }
  var TECH_BAG = [],
    bag = [],
    spawned = 0,
    frameNow = performance.now(),
    hoverBody = null;
  Object.keys(TECH).forEach(function (k) {
    for (var i = 0; i < TECH[k].weight; i++) TECH_BAG.push(k);
    if (TECH[k].hull) {
      // the body sits on the outline's centre of mass; remember the offset to draw the art in the right place
      var pts = Matter.Vertices.hull(TECH[k].hull.map(function (p) {
        return { x: p[0], y: p[1] };
      }));
      TECH[k].pts = pts;
      TECH[k].centre = Matter.Vertices.centre(pts);
    }
  });
  // types come out of a shuffled bag, so every kind shows up before any repeats
  function nextType() {
    if (!bag.length) {
      bag = TECH_BAG.slice();
      for (var i = bag.length - 1; i > 0; i--) {
        var j = (Math.random() * (i + 1)) | 0,
          t = bag[i];
        bag[i] = bag[j];
        bag[j] = t;
      }
    }
    return bag.pop();
  }
  function techBody(x, y, o, type) {
    type = type || nextType();
    var T = TECH[type],
      s = ((shapeR * 3) / 100) * T.size * rand(0.85, 1.15),
      b;
    if (T.pts) {
      b = Bodies.fromVertices(x, y, [T.pts.map(function (p) {
        return { x: p.x * s, y: p.y * s };
      })], o);
      b.tox = -T.centre.x;
      b.toy = -T.centre.y;
    } else {
      o.chamfer = { radius: T.r * s };
      b = Bodies.rectangle(x, y, T.w * s, T.h * s, o);
      b.tox = b.toy = 0;
    }
    b.tech = type;
    b.ts = s;
    b.seed = Math.random();
    b.born = b.typeT = frameNow + 600 + b.seed * 1500; // staggered starts
    b.snip = (Math.random() * 4) | 0;
    return b;
  }
  function drawTech(b) {
    ctx.scale(b.ts, b.ts);
    ctx.translate(b.tox, b.toy);
    TECH[b.tech].draw(b.col, b);
  }

  function spawnShape(x, y, still, type) {
    var r = rand(0.55, 1) * shapeR,
      k = (Math.random() * 3) | 0,
      b;
    var o = {
      restitution: 0.4,
      friction: 0.3,
      frictionAir: 0.014,
      density: 0.001,
    };
    // mostly tech objects: every seventh one is a plain shape, for variety
    if (type || ++spawned % 7) {
      o.restitution = 0.3;
      o.friction = 0.45;
      o.frictionAir = 0.016;
      o.density = 0.0007;
      b = techBody(x, y, o, type);
    } else if (k === 0) b = Bodies.circle(x, y, r, o);
    else if (k === 1) b = Bodies.rectangle(x, y, r * 1.8, r * 1.8, o);
    else b = Bodies.polygon(x, y, 3, r * 1.2, o);
    b.kind = "shape";
    b.k = b.tech ? -1 : k;
    b.col = pick(COL);
    Body.setVelocity(
      b,
      still
        ? { x: rand(-1, 1), y: rand(0, 2) }
        : {
            x: rand(-3, 3),
            y: engine.gravity.y < 0 ? rand(0, 4) : rand(-4, 0),
          },
    );
    Body.setAngularVelocity(b, rand(-0.2, 0.2));
    movers.push(b);
    Composite.add(engine.world, b);
    trimTo("shape", maxShapes);
  }
  // your own letters: press A to Z and that letter drops in
  function spawnLetter(ch) {
    var size = Math.max(40, fs * 0.45);
    ctx.font = size + 'px "Instrument Serif", Georgia, serif';
    var mw = ctx.measureText(ch).width * 0.92;
    var b = Bodies.rectangle(
      rand(60, Math.max(61, w - 60)),
      spawnY(),
      mw,
      size * 0.72,
      {
        chamfer: { radius: 6 },
        restitution: 0.4,
        friction: 0.4,
        frictionAir: 0.02,
        density: 0.0012,
        angle: rand(-0.5, 0.5),
      },
    );
    b.kind = "letter";
    b.typed = true;
    b.ch = ch;
    b.hot = 0;
    b.base = Math.random() < 0.5 ? 0 : 1;
    b.fsz = size;
    movers.push(b);
    Composite.add(engine.world, b);
    hit(b, 9, true);
    trimTo("typed", maxTyped);
  }
  function trimTo(what, max) {
    var list = movers.filter(function (m) {
      return what === "typed" ? m.typed : m.kind === what;
    });
    if (list.length <= max) return;
    while (list.length > max) {
      var old = list.shift();
      Composite.remove(engine.world, old);
      movers.splice(movers.indexOf(old), 1);
    }
    wakeAll(); // anything that was resting on a removed body must fall, not hover
  }

  /* =====================================================================
     POINTER: drag things, tap letters to pop them, tap empty space for shapes,
     hold empty space to enter, brush past things to nudge them
     ===================================================================== */
  // what is under the pointer: the body itself, or anything within a few pixels of its outline,
  // so pressing on the edge of an object grabs it instead of starting the hold-to-enter charge
  function pickBody(pt) {
    var hit = Query.point(movers, pt)[0];
    if (hit) return hit;
    var best = null,
      bestD = 10; // px of grace around every object
    movers.forEach(function (b) {
      var bb = b.bounds,
        dx = Math.max(bb.min.x - pt.x, 0, pt.x - bb.max.x),
        dy = Math.max(bb.min.y - pt.y, 0, pt.y - bb.max.y),
        d = Math.hypot(dx, dy);
      if (d < bestD && (b.kind === "shape" || d === 0)) {
        best = b;
        bestD = d;
      }
    });
    return best;
  }
  function spawnTrail(x, y, dx, dy) {
    if (RM) return;
    trail.push({
      x: x,
      y: y,
      vx: dx * 0.05,
      vy: dy * 0.05,
      s: 10 + Math.random() * 16,
      k: (Math.random() * 3) | 0,
      c: pick(COL),
      r: Math.random() * 6,
      life: 1,
    });
    if (trail.length > 140) trail.shift();
  }
  cv.addEventListener("pointerdown", function (e) {
    if (entered) return;
    ptr.x = prev.x = e.clientX;
    ptr.y = prev.y = e.clientY;
    seen = true;
    cv.setPointerCapture(e.pointerId);
    var hit = pickBody(ptr);
    if (hit) {
      wake(hit);
      drag = Constraint.create({
        pointA: { x: ptr.x, y: ptr.y },
        bodyB: hit,
        pointB: { x: ptr.x - hit.position.x, y: ptr.y - hit.position.y },
        stiffness: 0.12,
        damping: 0.08,
        length: 0,
      });
      drag.grabbed = hit;
      drag.t = performance.now();
      drag.sx = ptr.x;
      drag.sy = ptr.y;
      Composite.add(engine.world, drag);
    } else {
      charge = { t: performance.now(), x: ptr.x, y: ptr.y, c: 0 };
    }
  }, on);
  cv.addEventListener("pointermove", function (e) {
    prev.x = ptr.x;
    prev.y = ptr.y;
    ptr.x = e.clientX;
    ptr.y = e.clientY;
    seen = true;
    if (e.pointerType === "mouse") {
      ring.on = true;
      if (!ring.x) {
        ring.x = ptr.x;
        ring.y = ptr.y;
      }
    }
    if (drag) drag.pointA = { x: ptr.x, y: ptr.y };
    if (charge && !charge.key) {
      charge.x = ptr.x;
      charge.y = ptr.y;
    }
    var dx = ptr.x - lastTrail.x,
      dy = ptr.y - lastTrail.y;
    if (Math.hypot(dx, dy) > 26) {
      spawnTrail(ptr.x, ptr.y, dx, dy);
      lastTrail.x = ptr.x;
      lastTrail.y = ptr.y;
    }
    // brushing past objects nudges them, like a breeze
    var vx = clamp(ptr.x - prev.x, -40, 40),
      vy = clamp(ptr.y - prev.y, -40, 40);
    if (
      e.pointerType === "mouse" &&
      !drag &&
      !charge &&
      Math.hypot(vx, vy) > 12
    ) {
      movers.forEach(function (b) {
        var d = Math.hypot(b.position.x - ptr.x, b.position.y - ptr.y);
        if (d < 130) {
          var k = b.mass * 0.00004 * (1 - d / 130);
          wake(b);
          Body.applyForce(b, b.position, { x: vx * k, y: vy * k });
        }
      });
    }
  }, on);
  cv.addEventListener("pointerleave", function () {
    ring.on = false;
  }, on);
  function release() {
    var now = performance.now();
    if (drag) {
      Composite.remove(engine.world, drag);
      var b = drag.grabbed,
        s = Math.hypot(b.velocity.x, b.velocity.y);
      var tap =
        now - drag.t < 220 &&
        Math.hypot(ptr.x - drag.sx, ptr.y - drag.sy) < 10;
      if (tap) {
        // a quick tap makes the object jump and click softly
        wake(b);
        Body.setVelocity(b, {
          x: rand(-3, 3),
          y: (engine.gravity.y >= 0 ? -1 : 1) * 14,
        });
        Body.setAngularVelocity(b, rand(-0.25, 0.25));
        hit(b, 16, true);
        if (b.tech) techTap(b);
        if (!RM)
          for (var i = 0; i < 10; i++)
            parts.push({
              x: b.position.x,
              y: b.position.y,
              vx: rand(-6, 6),
              vy: rand(-8, 1),
              s: rand(6, 12),
              c: pick(COL),
              life: 1,
            });
      } else if (s > 45)
        Body.setVelocity(b, {
          x: (b.velocity.x * 45) / s,
          y: (b.velocity.y * 45) / s,
        });
      drag = null;
    }
    if (charge && !charge.key && now - charge.t < HOLD_START)
      spawnShape(charge.x, charge.y);
    charge = null;
  }
  cv.addEventListener("pointerup", release, on);
  cv.addEventListener("pointercancel", release, on);

  document.addEventListener("keydown", function (e) {
    if (entered || e.ctrlKey || e.metaKey || e.altKey) return;
    // hold Space or Enter to enter the site
    if (
      (e.key === " " || e.key === "Enter") &&
      !e.repeat &&
      (e.target === cv || e.target === document.body)
    ) {
      charge = {
        t: performance.now(),
        x: w / 2,
        y: h / 2,
        c: 0,
        key: true,
      };
      e.preventDefault();
    } else if (/^[a-z]$/i.test(e.key) && !e.repeat)
      spawnLetter(e.key.toUpperCase());
  }, on);
  document.addEventListener("keyup", function (e) {
    if ((e.key === " " || e.key === "Enter") && charge && charge.key)
      charge = null;
  }, on);

  /* =====================================================================
     ENTERING THE SITE
     ===================================================================== */
  function explode(x, y) {
    charge = null;
    entered = true;
    if (drag) {
      Composite.remove(engine.world, drag);
      drag = null;
    }
    movers.forEach(function (b) {
      var dx = b.position.x - x,
        dy = b.position.y - y,
        d = Math.hypot(dx, dy) || 1;
      wake(b);
      Body.setVelocity(b, { x: (dx / d) * 38, y: (dy / d) * 38 - 6 });
      Body.setAngularVelocity(b, rand(-0.3, 0.3));
      if (b.kind === "letter") b.hot = 1;
    });
    if (!RM)
      for (var i = 0; i < 140; i++) {
        var a = Math.random() * 6.283,
          s = 4 + Math.random() * 16;
        parts.push({
          x: x,
          y: y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          s: 5 + Math.random() * 10,
          c: COL[i % 4],
          life: 1,
        });
      }
    riseStop();
    confirmChime();
    setTimeout(
      function () {
        openSite(x, y);
      },
      RM ? 0 : 520,
    );
  }
  // the blue circle grows from where you let go, then the router swaps in home.html under it
  function openSite(x, y) {
    entered = true;
    site.style.setProperty("--ox", x + "px");
    site.style.setProperty("--oy", y + "px");
    site.classList.add("on");
    spawnTimers.push(
      setTimeout(
        function () {
          Site.go("home.html", { veil: "cover" });
        },
        RM ? 0 : 820,
      ),
    );
  }
  // rebuild the scene when the window changes size (debounced). A small height-only
  // change, like a phone's toolbar sliding away, just moves the floor.
  var resizeTimer = 0;
  addEventListener(
    "resize",
    function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (entered || !engine) return;
        if (innerWidth === w && Math.abs(innerHeight - h) < 90) fitHeight();
        else if (innerWidth !== w || innerHeight !== h) init();
      }, 200);
    },
    on,
  );

  /* =====================================================================
     DRAWING
     ===================================================================== */
  function mix(k) {
    return (
      "rgb(" +
      INK.map(function (v, i) {
        return Math.round(v + (BLUE[i] - v) * k);
      }).join(",") +
      ")"
    );
  }
  function roundRect(x, y, ww, hh, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + ww, y, x + ww, y + hh, r);
    ctx.arcTo(x + ww, y + hh, x, y + hh, r);
    ctx.arcTo(x, y + hh, x, y, r);
    ctx.arcTo(x, y, x + ww, y, r);
    ctx.closePath();
  }
  // small confetti or dust piece. life is clamped so the size can never go negative.
  function confetti(t) {
    var life = Math.max(0, t.life),
      s = t.s * life;
    if (s <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, life);
    ctx.fillStyle = t.c;
    ctx.translate(t.x, t.y);
    ctx.rotate(t.r + (1 - life) * 3);
    ctx.beginPath();
    if (t.k === 0 || t.k === undefined) ctx.arc(0, 0, s / 2, 0, 6.283);
    else if (t.k === 1) ctx.rect(-s / 2, -s / 2, s, s);
    else {
      ctx.moveTo(0, -s / 2);
      ctx.lineTo(s / 2, s / 2);
      ctx.lineTo(-s / 2, s / 2);
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  }

  // the portrait in the background: a blue spotlight follows you, the whole thing drifts a little, and it opens up while you hold
  var wmEl = $("wm"),
    litEl = $("lit"),
    guideEl = $("guide");
  function portrait(now) {
    var tx,
      ty,
      tr = w < 700 ? 170 : 250;
    if (charge && charge.c > 0) {
      tx = charge.x;
      ty = charge.y;
      tr += charge.c * Math.max(w, h) * 0.75;
    } else if (seen) {
      tx = ptr.x;
      ty = ptr.y;
    } else if (RM) {
      tx = w * 0.5;
      ty = h * 0.42;
    } else {
      tx = w * 0.5 + Math.sin(now * 0.0004) * w * 0.14;
      ty = h * 0.45 + Math.cos(now * 0.0003) * h * 0.06;
    } // idle drift before you move
    sp.x += (tx - sp.x) * 0.09;
    sp.y += (ty - sp.y) * 0.09;
    sp.r += (tr - sp.r) * 0.1;
    var ppx = 0,
      ppy = 0;
    if (!RM && seen) {
      ppx = -(ptr.x / w - 0.5) * 26;
      ppy = -(ptr.y / h - 0.5) * 16;
    }
    sp.px += (ppx - sp.px) * 0.06;
    sp.py += (ppy - sp.py) * 0.06;
    wmEl.style.setProperty("--px", sp.px + "px");
    wmEl.style.setProperty("--py", sp.py + "px");
    var r = wmEl.getBoundingClientRect();
    litEl.style.setProperty("--mx", sp.x - r.left + "px");
    litEl.style.setProperty("--my", sp.y - r.top + "px");
    litEl.style.setProperty("--r", sp.r + "px");
  }

  function tick(now) {
    if (!alive) return;
    frameNow = now;
    hoverBody = ring.on && !drag && !charge ? pickBody(ptr) : null;
    var dt = Math.min(50, now - last);
    last = now;
    acc += dt;

    // hold to enter: pull everything towards the pointer, then burst
    if (charge) {
      var el = now - charge.t;
      charge.c = clamp((el - HOLD_START) / (HOLD - HOLD_START), 0, 1);
      if (el > HOLD_START)
        movers.forEach(function (b) {
          var dx = charge.x - b.position.x,
            dy = charge.y - b.position.y,
            d = Math.hypot(dx, dy) || 1;
          var f =
            b.mass *
            0.0025 *
            (0.4 + charge.c * 1.2) *
            Math.min(1, d / 150);
          // the extra lift cancels gravity so things rise towards you
          wake(b);
          Body.applyForce(b, b.position, {
            x: (dx / d) * f,
            y:
              (dy / d) * f - engine.gravity.y * 0.001 * b.mass * charge.c,
          });
          Body.setVelocity(b, {
            x: b.velocity.x * 0.96,
            y: b.velocity.y * 0.96,
          });
        });
      if (charge.c >= 1) explode(charge.x, charge.y);
    }
    if (charge && charge.c > 0) riseUpdate(charge.c);
    else riseStop();
    // the guide's ring fills up while you hold
    var holding = !!(charge && charge.c > 0);
    guideEl.classList.toggle("holding", holding);
    guideEl.style.setProperty("--hold", holding ? charge.c : "");

    // Float mode: everything drifts slowly on its own
    if (MODES[mode].g === 0 && !RM) {
      var ts = now * 0.0006;
      movers.forEach(function (b, i) {
        Body.applyForce(b, b.position, {
          x: Math.sin(ts + i * 1.7) * b.mass * 0.00003,
          y: Math.cos(ts * 0.8 + i * 2.3) * b.mass * 0.00003,
        });
      });
    }
    while (acc >= 16.667) {
      Engine.update(engine, 16.667);
      acc -= 16.667;
    }
    portrait(now);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // the ground (and the ceiling when gravity is not Earth)
    ctx.fillStyle = rgba(INK, 0.14);
    ctx.fillRect(0, floorY, w, 1.5);
    if (mode > 0) ctx.fillRect(0, ceilY, w, 1.5);

    trail.forEach(function (t) {
      t.x += t.vx;
      t.y += t.vy;
      t.life -= 0.022;
      confetti(t);
    });
    trail = trail.filter(function (t) {
      return t.life > 0;
    });

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";
    movers.forEach(function (b) {
      ctx.save();
      ctx.translate(b.position.x, b.position.y);
      ctx.rotate(b.angle);
      if (b.kind === "letter") {
        var held = drag && drag.grabbed === b;
        b.hot = held
          ? Math.min(1, b.hot + 0.2)
          : Math.max(0, b.hot - 0.03);
        ctx.font = b.fsz + 'px "Instrument Serif", Georgia, serif';
        // a soft light outline keeps letters readable over the portrait
        ctx.lineWidth = b.fsz * 0.05;
        ctx.strokeStyle = rgba(BG, 0.9);
        ctx.strokeText(b.ch, 0, b.fsz * 0.35);
        ctx.fillStyle = mix(Math.max(b.hot, b.base));
        ctx.fillText(b.ch, 0, b.fsz * 0.35);
      } else if (b.kind === "pill") {
        roundRect(-b.pw / 2, -b.ph / 2, b.pw, b.ph, b.ph / 2);
        ctx.fillStyle = b.col;
        ctx.fill();
        ctx.font = "700 " + pf + 'px "DM Sans", system-ui, sans-serif';
        ctx.fillStyle = b.col === "#2f4bff" ? "#fff" : "#16161d";
        ctx.fillText(b.txt, 0, pf * 0.35);
      } else if (b.tech) {
        drawTech(b);
      } else {
        ctx.fillStyle = b.col;
        ctx.beginPath();
        if (b.k === 0) ctx.arc(0, 0, b.circleRadius, 0, 6.283);
        else {
          ctx.rotate(-b.angle);
          b.vertices.forEach(function (v, i) {
            var px = v.x - b.position.x,
              py = v.y - b.position.y;
            if (i) ctx.lineTo(px, py);
            else ctx.moveTo(px, py);
          });
          ctx.closePath();
        }
        ctx.fill();
      }
      ctx.restore();
    });

    parts.forEach(function (p) {
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.97;
      p.vy = p.vy * 0.97 + 0.25;
      p.life -= 0.016;
      confetti(p);
    });
    parts = parts.filter(function (p) {
      return p.life > 0;
    });

    if (charge && charge.c > 0) {
      ctx.save();
      ctx.fillStyle = "#ffd23f";
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(charge.x, charge.y, 20 + charge.c * 90, 0, 6.283);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.strokeStyle = rgba(INK, 1);
      ctx.beginPath();
      ctx.arc(
        charge.x,
        charge.y,
        28 + charge.c * 10,
        -Math.PI / 2,
        -Math.PI / 2 + charge.c * 6.283,
      );
      ctx.stroke();
      ctx.restore();
    }

    // custom cursor: a ring that trails the mouse and grows over things you can grab
    if (ring.on && !entered) {
      cv.style.cursor = "none";
      ring.x += (ptr.x - ring.x) * 0.28;
      ring.y += (ptr.y - ring.y) * 0.28;
      var over = drag || pickBody(ptr);
      ring.r += ((drag ? 24 : over ? 20 : 9) - ring.r) * 0.22;
      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = rgba(INK, 1);
      ctx.fillStyle = rgba(BLUE, over ? 0.14 : 0);
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, Math.max(1, ring.r), 0, 6.283);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = rgba(INK, 1);
      ctx.beginPath();
      ctx.arc(ptr.x, ptr.y, 2.5, 0, 6.283);
      ctx.fill();
      ctx.restore();
    } else cv.style.cursor = "default";

    requestAnimationFrame(tick);
  }

  // wait for the fonts so the sizes are right
  Promise.race([
    Promise.all([
      document.fonts.load('200px "Instrument Serif"'),
      document.fonts.load('700 20px "DM Sans"'),
    ]),
    new Promise(function (r) {
      setTimeout(r, 1500);
    }),
  ]).then(function () {
    if (!alive) return;
    init();
    last = performance.now();
    requestAnimationFrame(tick);
  });

  // leaving the welcome page: stop everything and let go of the sound bus
  return function unmount() {
    alive = false;
    life.abort();
    spawnTimers.forEach(clearTimeout);
    clearTimeout(resizeTimer);
    riseStop();
    audioOn = false;
    var nodes = busNodes;
    setTimeout(function () {
      nodes.forEach(function (n) {
        n.disconnect();
      });
    }, 400); // after the last tails have rung out
  };
});
