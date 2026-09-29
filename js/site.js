/* =====================================================================
   SITE: shared by every page.
   - theme toggle (light / dark, remembered)
   - sound + background music (one AudioContext for the whole visit)
   - volume slider (remembered)
   - a small History API router: it fetches the next page and swaps only the
     top bar and <main>, so the music never restarts. If anything goes wrong
     it falls back to a normal page load.
   Pages register themselves with Site.define("name", mount), where mount(main)
   may return an unmount function. <main data-scripts="..."> lists the extra
   scripts a page needs; they load once and stay loaded.
   ===================================================================== */
(function () {
  "use strict";

  var CONFIG = {
    master: 0.7, // overall volume of everything (music and the welcome page's sounds)
    music: {
      src: "song.mp3",
      level: 50, // default slider position in %, 50% = gain 0.08
      max: 0.32, // gain at 100%. gain = max * (slider / 100)^2, which feels even across the slider
      fadeIn: 2, // seconds
      fadeOut: 0.8,
      title: "Just Need Ya",
      artist: "by Reece Rosé & STREETSINEZ (NCS)",
    },
  };

  // DAILY VERSE: a small local collection, quoted exactly from the World English Bible (WEB),
  // which is in the public domain. Add or remove any; each needs the text and its reference.
  var VERSES = [
    ["Yahweh is my shepherd: I shall lack nothing.", "Psalm 23:1"],
    ["I can do all things through Christ, who strengthens me.", "Philippians 4:13"],
    ["Trust in Yahweh with all your heart, and don’t lean on your own understanding. In all your ways acknowledge him, and he will make your paths straight.", "Proverbs 3:5–6"],
    ["Haven’t I commanded you? Be strong and courageous. Don’t be afraid. Don’t be dismayed, for Yahweh your God is with you wherever you go.", "Joshua 1:9"],
    ["But those who wait for Yahweh will renew their strength. They will mount up with wings like eagles. They will run, and not be weary. They will walk, and not faint.", "Isaiah 40:31"],
    ["“For I know the thoughts that I think toward you,” says Yahweh, “thoughts of peace, and not of evil, to give you hope and a future.”", "Jeremiah 29:11"],
    ["Come to me, all you who labor and are heavily burdened, and I will give you rest.", "Matthew 11:28"],
    ["We know that all things work together for good for those who love God, to those who are called according to his purpose.", "Romans 8:28"],
    ["God is our refuge and strength, a very present help in trouble.", "Psalm 46:1"],
    ["Let all that you do be done in love.", "1 Corinthians 16:14"],
    ["It is because of Yahweh’s loving kindnesses that we are not consumed, because his compassion doesn’t fail. They are new every morning. Great is your faithfulness.", "Lamentations 3:22–23"],
    ["Your word is a lamp to my feet, and a light for my path.", "Psalm 119:105"],
    ["He has shown you, O man, what is good. What does Yahweh require of you, but to act justly, to love mercy, and to walk humbly with your God?", "Micah 6:8"],
    ["The light shines in the darkness, and the darkness hasn’t overcome it.", "John 1:5"],
    ["Now may the God of hope fill you with all joy and peace in believing, that you may abound in hope, in the power of the Holy Spirit.", "Romans 15:13"],
    ["For God didn’t give us a spirit of fear, but of power, love, and self-control.", "2 Timothy 1:7"],
    ["Also delight yourself in Yahweh, and he will give you the desires of your heart.", "Psalm 37:4"],
    ["Peace I leave with you. My peace I give to you; not as the world gives, give I to you. Don’t let your heart be troubled, neither let it be fearful.", "John 14:27"],
  ];

  var root = document.documentElement;
  var RM = matchMedia("(prefers-reduced-motion: reduce)");
  var events = new EventTarget();
  var store = {
    get: function (k, session) {
      try {
        return (session ? sessionStorage : localStorage).getItem("df:" + k);
      } catch (e) {
        return null;
      }
    },
    set: function (k, v, session) {
      try {
        (session ? sessionStorage : localStorage).setItem("df:" + k, v);
      } catch (e) {}
    },
  };
  function emit(name, detail) {
    events.dispatchEvent(new CustomEvent(name, { detail: detail }));
  }

  /* =====================================================================
     THEME
     ===================================================================== */
  var sysDark = matchMedia("(prefers-color-scheme: dark)");
  function currentTheme() {
    return root.dataset.theme === "dark" ? "dark" : "light";
  }
  function setTheme(t, save) {
    root.dataset.theme = t;
    if (save) store.set("theme", t);
    renderTheme();
    emit("theme", { theme: t });
  }
  function renderTheme() {
    var dark = currentTheme() === "dark";
    document.querySelectorAll("[data-theme-toggle]").forEach(function (b) {
      b.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
      b.setAttribute("title", dark ? "Light theme" : "Dark theme");
    });
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = dark ? "#121212" : "#fbfbfd";
  }
  sysDark.addEventListener("change", function (e) {
    if (!store.get("theme")) setTheme(e.matches ? "dark" : "light", false);
  });

  /* =====================================================================
     SOUND + MUSIC
     speakers <- master <- soft limiter <- music gain <- song.mp3
                                      \<- the welcome page's sound bus
     ===================================================================== */
  var AC = null,
    master = null,
    limiter = null,
    music = null,
    soundOn = false,
    pending = store.get("sound", true) === "on", // on in this tab before a full reload: resumes on your next tap or key
    sleepTimer = 0,
    vol = +(store.get("vol") || CONFIG.music.level);
  if (!(vol >= 0 && vol <= 100)) vol = CONFIG.music.level;

  function musicGain() {
    return CONFIG.music.max * Math.pow(vol / 100, 2);
  }
  // created on the first Sound press only (a user gesture), then reused for the whole visit
  function context() {
    if (AC) return AC;
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    AC = new C();
    master = AC.createGain();
    master.gain.value = CONFIG.master;
    // soft limiter: untouched below 0.6, then rounds off smoothly instead of clipping
    limiter = AC.createWaveShaper();
    var n = 2048,
      curve = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * 2 - 1,
        ax = Math.abs(x);
      curve[i] = ax < 0.6 ? x : (x < 0 ? -1 : 1) * (0.6 + 0.4 * Math.tanh((ax - 0.6) / 0.4));
    }
    limiter.curve = curve;
    limiter.oversample = "2x";
    limiter.connect(master);
    master.connect(AC.destination);
    setupMusic();
    return AC;
  }
  function setupMusic() {
    var el = new Audio();
    el.loop = true;
    el.preload = "auto";
    el.setAttribute("playsinline", "");
    el.src = CONFIG.music.src;
    music = { el: el, g: null, timer: 0, step: 0, failed: false };
    var pos = parseFloat(store.get("pos", true));
    if (pos > 0)
      el.addEventListener(
        "loadedmetadata",
        function () {
          if (pos < el.duration) el.currentTime = pos;
        },
        { once: true },
      );
    el.addEventListener("error", function () {
      music.failed = true;
      renderSound();
    });
    // routed through Web Audio so the volume also works on phones (iOS ignores el.volume).
    // Browsers silence files opened straight from disk (file://) inside the graph, so there it plays directly.
    if (location.protocol !== "file:") {
      try {
        var src = AC.createMediaElementSource(el);
        music.g = AC.createGain();
        music.g.gain.value = 0;
        src.connect(music.g);
        music.g.connect(limiter);
      } catch (e) {
        music.g = null;
      }
    }
    if (!music.g) el.volume = 0;
  }
  function rampTo(target, dur) {
    if (!music || music.failed) return;
    clearInterval(music.step);
    if (music.g) {
      var g = music.g.gain,
        t = AC.currentTime;
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
      else {
        g.cancelScheduledValues(t);
        g.setValueAtTime(g.value, t);
      }
      g.linearRampToValueAtTime(target, t + dur);
    } else {
      var el = music.el,
        v0 = el.volume,
        v1 = Math.min(1, target * CONFIG.master),
        s0 = performance.now();
      music.step = setInterval(function () {
        var k = Math.min(1, (performance.now() - s0) / (dur * 1000));
        el.volume = Math.max(0, Math.min(1, v0 + (v1 - v0) * k));
        if (k >= 1) clearInterval(music.step);
      }, 30);
    }
  }
  function musicFade(on) {
    if (!music || music.failed) return;
    var dur = on ? CONFIG.music.fadeIn : CONFIG.music.fadeOut;
    clearTimeout(music.timer);
    if (on) {
      var p = music.el.play();
      if (p && p.catch)
        p.catch(function () {
          /* play() was interrupted by a pause: harmless */
        });
    }
    rampTo(on ? musicGain() : 0, dur);
    if (!on)
      music.timer = setTimeout(function () {
        music.el.pause();
        savePos();
      }, dur * 1000 + 60);
  }
  // quiet time: let the audio thread sleep once everything has faded out
  function sleepSoon() {
    clearTimeout(sleepTimer);
    sleepTimer = setTimeout(
      function () {
        if (AC && (!soundOn || document.hidden) && AC.state === "running") AC.suspend();
      },
      CONFIG.music.fadeOut * 1000 + 200,
    );
  }
  function setSound(on) {
    pending = false;
    if (on && !context()) return;
    store.set("sound", on ? "on" : "off", true);
    clearTimeout(sleepTimer);
    if (on) {
      if (AC.state !== "running") AC.resume();
      soundOn = true;
      emit("sound", { on: true });
      musicFade(true);
    } else if (soundOn) {
      emit("sound", { on: false }); // pages play their "off" sound while it is still on
      soundOn = false;
      musicFade(false);
      sleepSoon();
    }
    soundOn = on;
    renderSound();
  }
  function setVolume(v) {
    vol = Math.max(0, Math.min(100, Math.round(v)));
    store.set("vol", vol);
    if (soundOn && music) rampTo(musicGain(), 0.08);
    renderVolume();
  }
  function savePos() {
    if (music && !music.failed && music.el.currentTime) store.set("pos", music.el.currentTime.toFixed(2), true);
  }
  function renderSound() {
    var on = soundOn || pending;
    document.querySelectorAll("[data-sound]").forEach(function (b) {
      b.setAttribute("aria-pressed", on);
      var v = b.querySelector(".val");
      if (v) v.textContent = on ? "On" : "Off";
    });
    var c = document.getElementById("credit");
    if (c) {
      var show = soundOn && !(music && music.failed);
      c.classList.toggle("on", show);
      c.setAttribute("aria-hidden", !show);
    }
  }
  function renderVolume() {
    var r = document.getElementById("vol");
    if (!r) return;
    r.value = vol;
    r.setAttribute("aria-valuetext", vol + "%");
    var o = document.getElementById("vol-out");
    if (o) o.textContent = vol + "%";
  }
  document.addEventListener("visibilitychange", function () {
    if (!AC || !soundOn) return;
    if (document.hidden) {
      musicFade(false);
      sleepSoon();
    } else {
      clearTimeout(sleepTimer);
      if (AC.state !== "running") AC.resume();
      musicFade(true);
    }
  });
  addEventListener("pagehide", savePos);
  // after a full reload with sound on, the next tap or key press (a user gesture) brings the music back
  function unlock(e) {
    if (!pending) return;
    if (e.target.closest && e.target.closest("[data-sound], [data-popover], .pop")) return;
    setSound(true);
  }
  document.addEventListener("pointerdown", unlock, true);
  document.addEventListener("keydown", unlock, true);

  /* ---- popovers: the volume slider and the daily verse ----
     A trigger is any <button data-popover aria-controls="id">. Only one popover is open at a
     time; Escape, a click outside or tabbing away closes it, and Escape puts focus back on
     the button that opened it. */
  var openPop = null; // { btn, pop } while one is open
  function setPop(btn, open, focusBack) {
    if (!btn) return;
    var pop = document.getElementById(btn.getAttribute("aria-controls"));
    if (!pop) return;
    if (open && openPop && openPop.btn !== btn) closePop();
    pop.hidden = !open;
    btn.setAttribute("aria-expanded", open);
    if (open) {
      openPop = { btn: btn, pop: pop };
      if (pop.id === "vol-pop") renderVolume();
      if (pop.id === "verse-pop") showVerse();
      // focus the first sensible thing inside, so keyboard users land in the popover
      var f = pop.querySelector("[data-autofocus]") || pop.querySelector("input, button, [tabindex]");
      if (f) f.focus();
    } else {
      if (openPop && openPop.btn === btn) openPop = null;
      if (focusBack) btn.focus();
    }
  }
  function closePop(focusBack) {
    if (openPop) setPop(openPop.btn, false, focusBack);
  }
  // a random verse, never the same one twice in a row
  var verseAt = -1;
  function showVerse() {
    var i;
    do i = Math.floor(Math.random() * VERSES.length);
    while (i === verseAt && VERSES.length > 1);
    verseAt = i;
    var t = document.querySelector("[data-verse-text]"),
      r = document.querySelector("[data-verse-ref]");
    if (t) t.textContent = VERSES[i][0];
    if (r) r.textContent = VERSES[i][1];
  }

  /* =====================================================================
     SHARED UI: persistent pieces that live outside the swapped content
     ===================================================================== */
  var veil, announcer;
  function chrome() {
    veil = document.createElement("div");
    veil.className = "veil";
    veil.setAttribute("aria-hidden", "true");
    announcer = document.createElement("div");
    announcer.className = "sr-only";
    announcer.setAttribute("aria-live", "polite");
    var credit = document.createElement("div");
    credit.className = "credit glass";
    credit.id = "credit";
    credit.setAttribute("aria-hidden", "true");
    credit.innerHTML = "<b></b><span></span>";
    credit.firstChild.textContent = CONFIG.music.title;
    credit.lastChild.textContent = CONFIG.music.artist;
    document.body.append(credit, veil, announcer);
  }
  document.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target : null;
    if (!t) return;
    var pb = t.closest("[data-popover]");
    if (t.closest("[data-sound]")) setSound(!(soundOn || pending));
    else if (pb) setPop(pb, pb.getAttribute("aria-expanded") !== "true");
    else if (t.closest("[data-verse-next]")) showVerse();
    else if (t.closest("[data-theme-toggle]")) setTheme(currentTheme() === "dark" ? "light" : "dark", true);
    // a click anywhere outside the open popover (and its button) closes it
    if (openPop && !openPop.pop.contains(t) && !openPop.btn.contains(t)) closePop();
  });
  document.addEventListener("input", function (e) {
    if (e.target.id === "vol") setVolume(e.target.value);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && openPop) {
      e.preventDefault();
      closePop(true);
    }
  });
  document.addEventListener("focusout", function (e) {
    if (!openPop || !e.relatedTarget) return;
    var r = e.relatedTarget;
    if (!openPop.pop.contains(r) && !openPop.btn.contains(r)) closePop();
  });
  // the glass catches a highlight that follows your cursor
  document.addEventListener("pointermove", function (e) {
    if (e.pointerType !== "mouse") return;
    var g = e.target.closest && e.target.closest(".glass");
    document.querySelectorAll(".glass").forEach(function (el) {
      if (el !== g) el.style.setProperty("--go", 0);
    });
    if (g) {
      var r = g.getBoundingClientRect();
      g.style.setProperty("--gx", e.clientX - r.left + "px");
      g.style.setProperty("--gy", e.clientY - r.top + "px");
      g.style.setProperty("--go", 1);
    }
  });
  function markActive() {
    var here = location.pathname.split("/").pop() || "index.html";
    if (here === "project.html") here = "work.html"; // project pages live under Lab
    document.querySelectorAll(".nav a").forEach(function (a) {
      var p = new URL(a.href, location.href).pathname.split("/").pop();
      if (p === here) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    document.querySelectorAll("[data-year]").forEach(function (y) {
      y.textContent = new Date().getFullYear();
    });
  }

  /* =====================================================================
     PAGES + ROUTER
     ===================================================================== */
  var pages = {},
    current = null,
    scripts = {},
    cache = {},
    navId = 0;
  var canRoute = /^https?:$/.test(location.protocol) && !!window.fetch && !!window.DOMParser && !!history.pushState;
  if (history.scrollRestoration) history.scrollRestoration = "manual";

  function loadScript(src) {
    var url = new URL(src, location.href).href;
    if (!scripts[url])
      scripts[url] = new Promise(function (res, rej) {
        var s = document.createElement("script");
        s.src = url;
        s.onload = res;
        s.onerror = function () {
          delete scripts[url];
          rej(new Error("Could not load " + src));
        };
        document.head.appendChild(s);
      });
    return scripts[url];
  }
  function mountPage() {
    var main = document.getElementById("app");
    if (!main) return Promise.resolve();
    var list = (main.dataset.scripts || "").split(/\s+/).filter(Boolean);
    return list
      .reduce(function (p, s) {
        return p.then(function () {
          return loadScript(s);
        });
      }, Promise.resolve())
      .then(function () {
        if (main !== document.getElementById("app")) return; // you already moved on
        var fn = pages[main.dataset.page];
        current = { main: main, unmount: fn ? fn(main) : null };
      });
  }
  function unmountPage() {
    if (current && typeof current.unmount === "function") current.unmount();
    current = null;
  }
  function routable(a) {
    if (!canRoute || a.target || a.hasAttribute("download") || a.dataset.router === "off") return false;
    var u = new URL(a.href, location.href);
    return u.origin === location.origin && /(\/|\.html)$/.test(u.pathname);
  }
  function fetchPage(href) {
    var key = href.split("#")[0];
    if (!cache[key])
      cache[key] = fetch(key, { credentials: "same-origin" })
        .then(function (r) {
          if (!r.ok) throw new Error(r.status);
          return r.text();
        })
        .catch(function (e) {
          delete cache[key];
          throw e;
        });
    return cache[key].then(function (t) {
      return new DOMParser().parseFromString(t, "text/html");
    });
  }
  function isWelcome(href) {
    var p = new URL(href, location.href).pathname;
    return /(\/|\/index\.html)$/.test(p);
  }
  function wait(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }
  // the old page steps out: a blue circle from where you clicked (to the welcome page), or a quick fade
  function leave(opts, toWelcome) {
    var main = document.getElementById("app");
    if (RM.matches) return Promise.resolve();
    if (opts.veil === "cover") {
      veil.className = "veil cover";
      return Promise.resolve();
    }
    if (toWelcome) {
      veil.style.setProperty("--ox", (opts.x == null ? innerWidth / 2 : opts.x) + "px");
      veil.style.setProperty("--oy", (opts.y == null ? innerHeight / 2 : opts.y) + "px");
      veil.className = "veil";
      void veil.offsetWidth;
      veil.className = "veil grow";
      return wait(650);
    }
    if (main) main.classList.add("is-leaving");
    return wait(180);
  }
  function go(href, opts) {
    opts = opts || {};
    if (!canRoute) {
      savePos();
      location.href = href;
      return;
    }
    var id = ++navId,
      toWelcome = isWelcome(href);
    if (!opts.pop) history.replaceState({ scroll: scrollY }, "");
    Promise.all([fetchPage(href), leave(opts, toWelcome)])
      .then(function (r) {
        if (id !== navId) return;
        if (!opts.pop) history.pushState({ scroll: 0 }, "", href);
        return swap(r[0], opts);
      })
      .catch(function (err) {
        if (id !== navId) return;
        if (window.console) console.warn("Falling back to a full page load:", err);
        savePos();
        location.href = href;
      });
  }
  function ensureStyles(doc) {
    var have = {};
    document.querySelectorAll('link[rel="stylesheet"]').forEach(function (l) {
      have[l.href] = 1;
    });
    var waits = [];
    doc.querySelectorAll('head link[rel="stylesheet"]').forEach(function (l) {
      var href = new URL(l.getAttribute("href"), location.href).href;
      if (have[href]) return;
      var n = document.createElement("link");
      n.rel = "stylesheet";
      n.href = href;
      waits.push(
        new Promise(function (res) {
          n.onload = n.onerror = res;
          setTimeout(res, 3000);
        }),
      );
      document.head.appendChild(n);
    });
    return Promise.all(waits);
  }
  function swap(doc, opts) {
    var nextMain = doc.getElementById("app"),
      nextBar = doc.querySelector("header.top");
    if (!nextMain || !nextBar) throw new Error("Page has no #app or header");
    return ensureStyles(doc).then(function () {
      unmountPage();
      document.title = doc.title;
      var d1 = document.querySelector('meta[name="description"]'),
        d2 = doc.querySelector('meta[name="description"]');
      if (d1 && d2) d1.content = d2.content;
      root.dataset.page = doc.documentElement.dataset.page || "";
      shown = location.pathname + location.search;
      var bar = document.querySelector("header.top");
      if (!bar || bar.dataset.bar !== nextBar.dataset.bar) {
        var nb = document.importNode(nextBar, true);
        if (bar) bar.replaceWith(nb);
        else document.body.prepend(nb);
      } else closePop();
      var main = document.importNode(nextMain, true);
      document.getElementById("app").replaceWith(main);
      markActive();
      renderSound();
      renderTheme();
      renderVolume();
      // scroll: back to where you were on back / forward, to the #target, or to the top
      var hash = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (opts.pop) scrollTo(0, opts.scroll || 0);
      else if (hash) hash.scrollIntoView();
      else scrollTo(0, 0);
      // the new page steps in
      if (!RM.matches) {
        if (/cover|grow/.test(veil.className)) {
          veil.className = "veil cover";
          void veil.offsetWidth;
          veil.className = "veil lift";
          setTimeout(function () {
            if (veil.className === "veil lift") veil.className = "veil";
          }, 900);
        } else {
          main.classList.add("is-entering");
          main.addEventListener(
            "animationend",
            function () {
              main.classList.remove("is-entering");
            },
            { once: true },
          );
        }
      } else veil.className = "veil";
      // move focus to the new page and announce it
      var f = main.querySelector("[data-focus]") || main.querySelector("h1");
      if (f && !opts.pop) {
        if (!f.hasAttribute("tabindex")) f.setAttribute("tabindex", "-1");
        f.focus({ preventScroll: true });
      }
      announcer.textContent = doc.title;
      return mountPage();
    });
  }
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || !routable(a)) return;
    var u = new URL(a.href, location.href);
    if (u.pathname === location.pathname && u.search === location.search) {
      if (u.hash) return; // in-page anchor: let the browser scroll
      e.preventDefault();
      return;
    }
    e.preventDefault();
    go(u.href, { x: e.clientX || null, y: e.clientY || null });
  });
  // warm the cache when you point at or focus a link, so the swap feels instant
  function prefetch(e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (a && routable(a)) fetchPage(a.href).catch(function () {});
  }
  document.addEventListener("pointerover", prefetch, { passive: true });
  document.addEventListener("focusin", prefetch);
  var shown = location.pathname + location.search; // the page currently on screen
  addEventListener("popstate", function (e) {
    // back / forward between #anchors on the same page: the browser just scrolls, nothing to fetch
    if (location.pathname + location.search === shown) return;
    go(location.href, { pop: true, scroll: e.state && e.state.scroll });
  });

  /* =====================================================================
     PUBLIC API
     ===================================================================== */
  window.Site = {
    define: function (name, mount) {
      pages[name] = mount;
    },
    go: go,
    on: function (name, fn, signal) {
      events.addEventListener(name, fn, signal ? { signal: signal } : undefined);
    },
    reducedMotion: function () {
      return RM.matches;
    },
    sound: {
      isOn: function () {
        return soundOn;
      },
      context: function () {
        return AC;
      }, // null until the first Sound press
      output: function () {
        return limiter;
      }, // connect page sounds here
    },
  };

  /* =====================================================================
     SCROLL POINTER: a small mouse-pointer on the right edge that stands in for the
     desktop scrollbar. It only *reflects* and *sets* the real scroll position
     (window.scrollTo), so wheel, trackpad, keys and touch keep working natively.
     Mouse / trackpad screens only; the native scrollbar is hidden only once this
     has been built, so if anything fails the normal scrollbar stays.
     ===================================================================== */
  var TOP_GAP = 84, // keeps it below the top bar
    BOTTOM_GAP = 24,
    THUMB = 40; // the (invisible) interaction box; the pointer drawn inside it is smaller
  function initScroller() {
    if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return; // phones and tablets: native
    var el;
    try {
      el = document.createElement("div");
      el.className = "scroller";
      el.tabIndex = 0;
      el.setAttribute("role", "scrollbar");
      el.setAttribute("aria-orientation", "vertical");
      el.setAttribute("aria-controls", "app");
      el.setAttribute("aria-label", "Page scroll position");
      el.setAttribute("aria-valuemin", "0");
      el.setAttribute("aria-valuemax", "100");
      el.innerHTML =
        '<svg viewBox="0 0 18 24" aria-hidden="true"><path class="sc-body" d="M2.5 2.2v17.6l4.5-4.3 3.2 7.2 3.3-1.4-3.1-7.1h6.3z"/><path class="sc-shine" d="M4.2 5.6v9.2"/></svg>' +
        '<span class="scroller-label" aria-hidden="true">0%</span>';
      document.body.appendChild(el);
    } catch (e) {
      return;
    }
    var label = el.querySelector(".scroller-label"),
      queued = false,
      drag = null;
    function maxScroll() {
      return Math.max(0, document.documentElement.scrollHeight - innerHeight);
    }
    function range() {
      return Math.max(1, innerHeight - TOP_GAP - BOTTOM_GAP - THUMB);
    }
    // place the pointer to match the page's scroll position
    function update() {
      queued = false;
      var max = maxScroll();
      el.hidden = max < 8; // nothing to scroll (e.g. the welcome screen): no indicator
      if (el.hidden) return;
      var p = Math.min(1, Math.max(0, scrollY / max)),
        pct = Math.round(p * 100);
      el.style.setProperty("--sy", TOP_GAP + p * range() + "px");
      el.setAttribute("aria-valuenow", pct);
      el.setAttribute("aria-valuetext", pct + "% down the page");
      label.textContent = pct + "%";
    }
    function queue() {
      if (!queued) {
        queued = true;
        requestAnimationFrame(update);
      }
    }
    addEventListener("scroll", queue, { passive: true });
    addEventListener("resize", queue);
    if (window.ResizeObserver) new ResizeObserver(queue).observe(document.body); // page swaps, images loading
    // DRAG: move the pointer, and the page follows (instantly, not smoothed)
    el.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      var r = el.getBoundingClientRect();
      drag = { off: e.clientY - r.top };
      el.classList.add("dragging");
      el.focus({ preventScroll: true });
    });
    el.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var p = (e.clientY - drag.off - TOP_GAP) / range();
      scrollTo({ top: Math.min(1, Math.max(0, p)) * maxScroll(), behavior: "instant" });
    });
    function stop() {
      drag = null;
      el.classList.remove("dragging");
    }
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
    el.addEventListener("lostpointercapture", stop);
    // KEYBOARD: the usual scrollbar keys
    el.addEventListener("keydown", function (e) {
      var step = { ArrowDown: 60, ArrowUp: -60, PageDown: innerHeight * 0.9, PageUp: -innerHeight * 0.9 }[e.key];
      if (step) scrollBy({ top: step });
      else if (e.key === "Home") scrollTo({ top: 0 });
      else if (e.key === "End") scrollTo({ top: maxScroll() });
      else return;
      e.preventDefault();
    });
    update();
    root.classList.add("has-scroller"); // only now is the native scrollbar hidden (see css)
    queue();
  }

  function boot() {
    chrome();
    initScroller();
    markActive();
    renderSound();
    renderTheme();
    renderVolume();
    history.replaceState({ scroll: scrollY }, "");
    mountPage().catch(function (e) {
      console.error(e);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
