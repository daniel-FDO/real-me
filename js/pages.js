/* =====================================================================
   PAGES: the small bits of behaviour for home, work, project, about and
   contact. Each one is mounted by js/site.js when its page is shown.
   Project content comes from js/projects.js.
   ===================================================================== */
(function () {
  "use strict";

  // CONTACT: where the form goes. Leave `endpoint` empty to open the visitor's email app
  // instead, or paste a form service URL (for example a Formspree endpoint) to send it directly.
  var CONTACT = {
    email: "hello@example.com", // placeholder, use your own address
    endpoint: "",
  };

  var P = window.PROJECTS || [];
  var TAG_COLORS = ["", "blue", "pink", "mint"];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function tagClass(tag) {
    var all = [];
    P.forEach(function (p) {
      p.tags.forEach(function (t) {
        if (all.indexOf(t) < 0) all.push(t);
      });
    });
    return TAG_COLORS[all.indexOf(tag) % TAG_COLORS.length];
  }
  // generated cover art (the project's colours + the welcome page's shapes), used when a project has no screenshot yet
  function cover(p) {
    var c = p.colors || [];
    var style = "--c1:" + c[0] + ";--c2:" + c[1] + ";--c3:" + c[2] + ";--c4:" + c[3] + ";--ct:" + (c[4] || "#fff");
    return (
      '<div class="cover" style="' + esc(style) + '" aria-hidden="true">' +
      '<i class="s0"></i><i class="s1"></i><i class="s2"></i><span class="t">' + esc(p.title) + "</span></div>"
    );
  }
  function host(url) {
    try {
      return new URL(url).host;
    } catch (e) {
      return url || "";
    }
  }
  // a project's screenshot in a small browser frame (three dots + address), or a phone-shaped frame
  function shot(p, kind, opts) {
    opts = opts || {};
    var src = p.shots && p.shots[kind];
    if (!src) return cover(p);
    var phone = kind === "mobile";
    var alt = opts.alt != null ? opts.alt : "Screenshot of the " + p.title + (phone ? " site on a phone" : " home page");
    return (
      '<figure class="browser' + (phone ? " phone" : "") + '">' +
      (phone ? "" : '<div class="bar" aria-hidden="true"><i></i><i></i><i></i><span>' + esc(host(p.url)) + "</span></div>") +
      '<img src="' + esc(src) + '" alt="' + esc(alt) + '" width="' + (phone ? 780 : 1440) + '" height="' + (phone ? 1688 : 900) + '"' +
      ' loading="' + (opts.eager ? "eager" : "lazy") + '" decoding="async" draggable="false">' +
      (opts.caption ? "<figcaption>" + esc(opts.caption) + "</figcaption>" : "") +
      "</figure>"
    );
  }
  function chips(p) {
    return (
      '<ul class="chips" aria-label="Tags">' +
      p.tags.map(function (t) {
        return '<li class="chip ' + tagClass(t) + '">' + esc(t) + "</li>";
      }).join("") +
      "</ul>"
    );
  }
  function card(p, level) {
    var h = "h" + (level || 3);
    return (
      '<a class="card" href="project.html?p=' + encodeURIComponent(p.slug) + '">' +
      shot(p, "desktop", { alt: "" }) +
      '<div class="card-body"><p class="card-meta">' + esc(p.type) + "</p>" +
      "<" + h + ' class="h3">' + esc(p.title) + "</" + h + ">" +
      "<p>" + esc(p.summary) + "</p>" + chips(p) +
      "</div></a>"
    );
  }

  /* ---------- LIVE CLOCK ----------
     Intl formats the time in the Europe/London zone, so the switch between GMT and BST
     happens automatically. Ticking every second is cheap and keeps the minute exact. */
  function londonClock(el) {
    if (!el) return null;
    var fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    function tick() {
      var now = new Date();
      el.textContent = fmt.format(now);
      el.setAttribute("datetime", now.toISOString());
    }
    tick();
    var id = setInterval(tick, 1000);
    return function () {
      clearInterval(id);
    };
  }

  /* ---------- PROJECT SHOWCASE ----------
     A tilted stack of browser cards you can drag (mouse), swipe (touch) or arrow through (keyboard).
     `pos` is a continuous position: 1.4 means 40% of the way from project 2 to project 3.
     Every card is placed from its distance to `pos`, so dragging (fractional) and snapping
     (whole numbers, animated by a CSS transition) share the same layout function. */
  function showcase(root) {
    if (!root || !P.length) return null;
    var n = P.length,
      active = 0,
      pos = 0;
    var stage = root.querySelector(".stage"),
      list = root.querySelector(".slides"),
      tags = [].slice.call(root.querySelectorAll(".tag")),
      status = root.querySelector("[data-status]");

    list.innerHTML = P.map(function (p, i) {
      return (
        '<li class="slide" aria-roledescription="slide" aria-label="' + (i + 1) + " of " + n + ": " + esc(p.title) + '">' +
        '<a class="frame" href="' + esc(p.url) + '" target="_blank" rel="noopener" draggable="false"' +
        ' aria-label="Open the ' + esc(p.title) + ' live site (opens in a new tab)">' +
        shot(p, "desktop", { alt: "", eager: i < 2 }) +
        '<span class="visit">Open live site <span aria-hidden="true">↗</span></span></a></li>'
      );
    }).join("");
    var slides = [].slice.call(list.children);

    // distance of card i from position p, wrapped so it lies in (-1, n-1]
    function dist(i, p) {
      var d = (((i - p) % n) + n) % n;
      return d > n - 1 ? d - n : d;
    }
    // where a card sits at distance d: 0 = front, 1, 2 … fanned out behind it, -1 = swiped away to the left
    function pose(el, d) {
      var x, y, z, s, o, r;
      if (d < 0) {
        x = d * 85; y = -d * 4; z = 0; s = 1; o = 1 + d * 1.4; r = d * 8;
      } else {
        var e = Math.min(d, 2); // cards further back stay tucked in, so nothing pokes off the side of the page
        x = e * 9; y = -e * 6; z = -d * 70; s = 1 - e * 0.07; o = 3 - d; r = 0;
      }
      el.style.transform = "translate3d(" + x + "%," + y + "%," + z + "px) rotate(" + r + "deg) scale(" + s + ")";
      el.style.opacity = Math.max(0, Math.min(1, o));
      el.style.zIndex = String(100 - Math.round(Math.abs(d) * 10) - (d < 0 ? 5 : 0));
    }
    function layout(p) {
      pos = p;
      slides.forEach(function (el, i) {
        pose(el, dist(i, p));
      });
    }
    // snap to project i along the shortest way round, update the tags and tell screen readers
    function go(i, announce) {
      active = ((i % n) + n) % n;
      var delta = (((active - pos) % n) + n) % n;
      if (delta > n / 2) delta -= n;
      stage.classList.remove("dragging");
      layout(pos + delta);
      slides.forEach(function (el, k) {
        var front = k === active;
        el.classList.toggle("front", front);
        el.setAttribute("aria-hidden", !front);
        el.querySelector("a").tabIndex = front ? 0 : -1;
      });
      setTags(P[active]);
      if (announce) status.textContent = P[active].title + ", project " + (active + 1) + " of " + n;
    }
    // the floating words change to suit the project, replaying their pop-in animation
    function setTags(p) {
      tags.forEach(function (t, k) {
        var word = (p.float || [])[k] || "";
        if (t.textContent === word) return;
        t.classList.remove("tag-in");
        void t.offsetWidth; // restart the CSS animation
        t.textContent = word;
        t.hidden = !word;
        t.classList.add("tag-in");
      });
    }

    // DRAGGING: pointer events cover mouse, touch and pen. We only take over once the pointer has
    // clearly moved sideways, so an up/down swipe still scrolls the page (the stage has touch-action: pan-y).
    var drag = null,
      dragged = false;
    stage.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, start: pos, lastX: e.clientX, lastT: e.timeStamp, v: 0, on: false, w: stage.offsetWidth };
      dragged = false;
    });
    stage.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      if (!drag.on) {
        if (Math.abs(dx) < 8) {
          if (Math.abs(dy) > 8) drag = null; // mostly vertical: leave it to the page
          return;
        }
        drag.on = dragged = true;
        stage.setPointerCapture(e.pointerId);
        stage.classList.add("dragging"); // no transition while the card follows your finger
        root.classList.add("used"); // the "Swipe to explore" hint has done its job
      }
      // smoothed velocity in px per ms, so a quick flick moves on even if it was short
      var dt = Math.max(1, e.timeStamp - drag.lastT);
      drag.v = 0.7 * ((e.clientX - drag.lastX) / dt) + 0.3 * drag.v;
      drag.lastX = e.clientX;
      drag.lastT = e.timeStamp;
      layout(drag.start - dx / (drag.w * 0.8));
    });
    function end() {
      var d = drag;
      drag = null;
      if (!d || !d.on) return;
      // where the flick would carry us, snapped to a whole card, at most one card per swipe
      var base = Math.round(d.start),
        target = Math.round(pos - (d.v * 220) / (d.w * 0.8));
      go(Math.max(base - 1, Math.min(base + 1, target)), true);
    }
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
    stage.addEventListener("lostpointercapture", function (e) {
      // on touch the image under your finger holds the pointer first; when the stage takes it over,
      // the image's own "lost capture" bubbles up here and must not end the swipe
      if (e.target === stage) end();
    });
    stage.addEventListener("dragstart", function (e) {
      e.preventDefault(); // stop the browser dragging the image or link instead
    });
    // a drag must never count as a click, and clicking a card behind the front one brings it forward
    stage.addEventListener(
      "click",
      function (e) {
        if (dragged) {
          e.preventDefault();
          e.stopPropagation();
          dragged = false;
          return;
        }
        var li = e.target.closest(".slide"),
          i = slides.indexOf(li);
        if (li && i !== active) {
          e.preventDefault();
          go(i, true);
        }
      },
      true,
    );
    // KEYBOARD: arrows, Home and End while the stage (or the link inside it) has focus
    stage.addEventListener("keydown", function (e) {
      var k = e.key;
      if (k === "ArrowRight") go(active + 1, true);
      else if (k === "ArrowLeft") go(active - 1, true);
      else if (k === "Home") go(0, true);
      else if (k === "End") go(n - 1, true);
      else return;
      e.preventDefault();
      root.classList.add("used");
    });
    // hidden-until-focused buttons for keyboard and screen reader users
    root.querySelector("[data-prev]").addEventListener("click", function () {
      go(active - 1, true);
    });
    root.querySelector("[data-next]").addEventListener("click", function () {
      go(active + 1, true);
    });

    // first layout without animating in from nowhere
    stage.classList.add("dragging");
    go(0);
    void stage.offsetWidth;
    stage.classList.add("ready");
    requestAnimationFrame(function () {
      stage.classList.remove("dragging");
    });
    return null;
  }

  /* ---------- ROTATING HEADLINE ----------
     Two independent loops: the sentence changes every 2 minutes and the highlighted word
     cycles through five languages every 4 seconds. Neither loop resets the other.
     Each changing part is a stack of spans (see css "ROTATING HEADLINE"): we only move the
     "is-on" class from one span to the next and CSS does the masked slide and fade.
     Screen readers get one stable English heading instead (a visually hidden copy). */
  var HEADLINE = { sentenceMs: 120000, wordMs: 4000 };
  function stepper(stack) {
    var items = stack ? [].slice.call(stack.children) : [],
      i = 0;
    return function next() {
      if (items.length < 2) return;
      var old = items[i];
      i = (i + 1) % items.length;
      old.classList.remove("is-on");
      old.classList.add("is-out");
      setTimeout(function () {
        old.classList.remove("is-out");
      }, 520);
      items[i].classList.add("is-on");
    };
  }
  function headline(main) {
    var root = main.querySelector("[data-headline]"),
      btn = main.querySelector("[data-headline-toggle]");
    if (!root) return null;
    // the sentence box is as tall as the sentence showing (no blank space kept for longer ones);
    // CSS eases the height when it changes, and it is re-measured if fonts load or the window resizes
    function placeLabel() {
      var on = root.querySelector(":scope > .is-on");
      if (on) root.style.setProperty("--ht-h", on.offsetHeight + "px");
    }
    placeLabel();
    var ro = window.ResizeObserver ? new ResizeObserver(placeLabel) : null;
    if (ro)
      [].forEach.call(root.children, function (item) {
        ro.observe(item);
      });
    // reduced motion: keep the first English headline, no cycling, nothing to pause
    if (Site.reducedMotion()) {
      if (btn) btn.hidden = true;
      return function () {
        if (ro) ro.disconnect();
      };
    }
    var stepSentence = stepper(root),
      // every sentence carries its own copy of the word; they all step together
      wordSteppers = [].slice.call(root.querySelectorAll(".ht-word")).map(stepper),
      nextLang = stepper(main.querySelector(".ht-lang"));
    function nextSentence() {
      stepSentence();
      placeLabel();
    }
    function nextWord() {
      wordSteppers.forEach(function (f) {
        f();
      });
    }
    var timers = [],
      paused = false;
    function start() {
      if (timers.length || paused || document.hidden) return;
      timers.push(setInterval(nextSentence, HEADLINE.sentenceMs));
      timers.push(
        setInterval(function () {
          nextWord();
          nextLang(); // the label under the word follows it
        }, HEADLINE.wordMs),
      );
    }
    function stop() {
      timers.forEach(clearInterval);
      timers = [];
    }
    function onVisibility() {
      if (document.hidden) stop();
      else start();
    }
    if (btn)
      btn.addEventListener("click", function () {
        paused = !paused;
        btn.setAttribute("aria-pressed", paused);
        btn.setAttribute("aria-label", paused ? "Resume headline animation" : "Pause headline animation");
        if (paused) stop();
        else start();
      });
    document.addEventListener("visibilitychange", onVisibility);
    start();
    return function () {
      stop();
      if (ro) ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }

  /* ---------- LIVING WORKSPACE ----------
     Two tiny decorative scenes behind the hero: a football rolling and a cursor clicking. A small
     scheduler ticks twice a second, starts a scene when its wait is over and never lets more than
     MAX play at once. Everything pauses while the hero is off-screen or the tab is hidden. */
  function workspace(main) {
    var root = main.querySelector("[data-workspace]");
    if (!root || Site.reducedMotion()) return null;
    var MAX = 2,
      TICK = 500,
      playing = 0,
      paused = false,
      onScreen = true;
    // len = how long a scene lasts (matches --len in the CSS), gap = rest before it plays again
    var scenes = [
      { sel: ".ws-cursor", len: 4800, gap: 11000, wait: 1500 },
      { sel: ".ws-ball", len: 7000, gap: 13000, wait: 8000 },
    ].map(function (s) {
      s.el = root.querySelector(s.sel);
      s.left = 0;
      return s;
    });
    function play(s) {
      s.el.classList.remove("play");
      void s.el.offsetWidth; // restart the CSS animation
      s.el.classList.add("play");
      s.left = s.len;
      playing++;
    }
    function finish(s) {
      s.el.classList.remove("play");
      s.left = 0;
      s.wait = s.gap;
      playing--;
    }
    var ticker = setInterval(function () {
      if (paused) return;
      scenes.forEach(function (s) {
        // objects hidden at this screen size (display: none) simply never play
        if (!s.el || !s.el.getClientRects().length) return;
        if (s.left > 0) {
          s.left -= TICK;
          if (s.left <= 0) finish(s);
        } else if ((s.wait -= TICK) <= 0) {
          if (playing < MAX) play(s);
          else s.wait = 1500; // too busy: try again shortly
        }
      });
    }, TICK);
    function update() {
      paused = !onScreen || document.hidden;
      root.classList.toggle("paused", paused);
    }
    var io =
      "IntersectionObserver" in window
        ? new IntersectionObserver(function (e) {
            onScreen = e[0].isIntersecting;
            update();
          })
        : null;
    if (io) io.observe(root);
    document.addEventListener("visibilitychange", update);
    return function () {
      clearInterval(ticker);
      if (io) io.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }

  /* ---------- INTERACTIVE TECH OBJECTS ----------
     A terminal, a microchip, two keycaps and a browser wireframe sit in open spots on the page.
     Each has its own slow, staggered routine (see JOBS), and three respond to you:
       - the terminal replays its typing when pressed
       - the Enter keycap springs when pressed
       - the microchip lights its circuit on hover, focus or press
     They are real <button>s, so keyboard and touch work too. Routines only run while their
     object is on screen and the tab is visible; with reduced motion they sit still. */
  var TERM = [
    ["npm run dev", "ready on localhost:3000"],
    ['git commit -m "polish"', "1 file changed"],
    ["node hello.js", "Hello from Kent!"],
    ["open dF.html", "✓ experience loaded"],
  ];
  function restart(el, cls) {
    // re-trigger a one-shot CSS animation
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }
  function decos(main) {
    var RM = Site.reducedMotion(),
      term = main.querySelector("[data-deco-term]"),
      chip = main.querySelector("[data-deco-chip]"),
      enter = main.querySelector("[data-deco-enter]"),
      escKey = main.querySelector(".kc-esc"),
      wire = main.querySelector(".cta-wire"),
      visible = new Set(),
      snip = 0,
      typer = 0;

    // TERMINAL: types "$ command", then the output line, a character at a time
    function type(i) {
      if (!term) return;
      var code = term.querySelector("code"),
        lines = TERM[i % TERM.length],
        full = lines[0].length + lines[1].length,
        n = RM ? full : 0;
      clearInterval(typer);
      function render() {
        var a = lines[0].slice(0, Math.min(n, lines[0].length)),
          b = lines[1].slice(0, Math.max(0, n - lines[0].length));
        code.innerHTML =
          '<span class="p">$</span> ' + esc(a) + (b || n > lines[0].length ? '\n<span class="o">' + esc(b) + "</span>" : "");
      }
      render();
      if (RM) return;
      typer = setInterval(function () {
        n++;
        render();
        if (n >= full) clearInterval(typer);
      }, 55);
    }
    if (term)
      term.addEventListener("click", function () {
        type(snip); // replay the current snippet
      });
    // ENTER: a springy press
    if (enter)
      enter.addEventListener("click", function () {
        restart(enter, "spring");
      });
    // CHIP: hover / focus light it with CSS; pressing toggles it on (the touch equivalent of hovering)
    if (chip)
      chip.addEventListener("click", function () {
        var on = chip.getAttribute("aria-pressed") !== "true";
        chip.setAttribute("aria-pressed", on);
        if (!on) chip.blur();
      });

    // the staggered routines: every `every` ms, first after `at` ms
    var JOBS = [
      { el: term, at: 800, every: 10000, run: function () { type(++snip); } },
      { el: chip, at: 2600, every: 6500, run: function () { restart(chip, "pulse"); } },
      { el: escKey, at: 4800, every: 8500, run: function () { restart(escKey, "tap"); } },
      { el: wire, at: 1400, every: 13000, run: function () { restart(wire, "draw"); } },
    ].filter(function (j) {
      return j.el;
    });
    type(0);
    if (wire && RM) wire.classList.add("drawn");
    var TICK = 250,
      ticker = RM
        ? 0
        : setInterval(function () {
            if (document.hidden) return;
            JOBS.forEach(function (j) {
              if (!visible.has(j.el)) return; // off-screen: wait
              if ((j.at -= TICK) <= 0) {
                j.at = j.every;
                j.run();
              }
            });
          }, TICK);
    var io =
      "IntersectionObserver" in window
        ? new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
              if (e.isIntersecting) visible.add(e.target);
              else visible.delete(e.target);
            });
          })
        : null;
    JOBS.forEach(function (j) {
      if (io) io.observe(j.el);
      else visible.add(j.el);
    });
    return function () {
      clearInterval(ticker);
      clearInterval(typer);
      if (io) io.disconnect();
    };
  }

  /* ---------- home: headline, clock, showcase, workspace and the recent work grid ---------- */
  Site.define("home", function (main) {
    var box = main.querySelector("[data-featured]");
    if (box) box.innerHTML = P.map(function (p) {
      return card(p, 3);
    }).join("");
    var stops = [
      headline(main),
      workspace(main),
      decos(main),
      londonClock(main.querySelector("[data-clock]")),
      showcase(main.querySelector("[data-showcase]")),
    ];
    return function () {
      stops.forEach(function (f) {
        if (f) f();
      });
    };
  });

  /* ---------- work (Lab): every project, with tag filters ---------- */
  Site.define("work", function (main) {
    var grid = main.querySelector("[data-projects]"),
      bar = main.querySelector("[data-filters]"),
      count = main.querySelector("[data-count]");
    if (!grid) return;
    grid.innerHTML = P.map(function (p) {
      return card(p, 2);
    }).join("");
    var tags = [];
    P.forEach(function (p) {
      p.tags.forEach(function (t) {
        if (tags.indexOf(t) < 0) tags.push(t);
      });
    });
    bar.innerHTML = ["All"].concat(tags).map(function (t, i) {
      return '<button class="chip line" type="button" aria-pressed="' + (i === 0) + '" data-tag="' + esc(t) + '">' + esc(t) + "</button>";
    }).join("");
    function filter(tag) {
      var shown = 0;
      grid.querySelectorAll(".card").forEach(function (el, i) {
        var ok = tag === "All" || P[i].tags.indexOf(tag) > -1;
        el.hidden = !ok;
        if (ok) shown++;
      });
      bar.querySelectorAll("button").forEach(function (b) {
        b.setAttribute("aria-pressed", b.dataset.tag === tag);
      });
      count.textContent = shown + (shown === 1 ? " project" : " projects");
    }
    bar.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-tag]");
      if (b) filter(b.dataset.tag);
    });
    filter("All");
  });

  /* ---------- project: one template for every project ---------- */
  Site.define("project", function (main) {
    var slug = new URLSearchParams(location.search).get("p"),
      i = -1;
    P.forEach(function (p, k) {
      if (p.slug === slug) i = k;
    });
    var out = main.querySelector("[data-project]");
    if (i < 0) {
      document.title = "Project not found | Daniel Fasan";
      out.innerHTML =
        '<section class="section"><h1 class="h2" tabindex="-1">That project isn’t here.</h1>' +
        '<p class="lede">It may have moved. Have a look at everything else instead.</p>' +
        '<div class="btns"><a class="btn" href="work.html">See all projects</a></div></section>';
      out.querySelector("h1").focus({ preventScroll: true });
      return;
    }
    var p = P[i],
      prev = P[(i - 1 + P.length) % P.length],
      next = P[(i + 1) % P.length];
    document.title = p.title + " | Daniel Fasan";
    // only the facts this project actually has
    var facts = [
      ["Type", esc(p.type)],
      ["Built for", esc(p.builtFor)],
      ["Live site", p.url ? '<a class="link" href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(host(p.url)) + " ↗</a>" : ""],
    ].filter(function (f) {
      return f[1];
    });
    out.innerHTML =
      '<section class="p-hero">' +
      '<a class="link" href="work.html">← All projects</a>' +
      '<h1 class="display" tabindex="-1">' + esc(p.title) + "</h1>" +
      '<p class="lede">' + esc(p.summary) + "</p>" +
      '<div style="margin-top:18px">' + chips(p) + "</div>" +
      '<div class="p-shot">' + shot(p, "desktop", { eager: true }) + "</div>" +
      '<dl class="facts glass">' +
      facts.map(function (f) {
        return "<div><dt>" + f[0] + "</dt><dd>" + f[1] + "</dd></div>";
      }).join("") +
      "</dl></section>" +
      (p.sections || []).map(function (s) {
        return '<section class="story"><h2>' + esc(s.heading) + '</h2><div class="prose"><p>' + esc(s.body) + "</p></div></section>";
      }).join("") +
      (p.shots && p.shots.mobile
        ? '<section class="gallery" aria-label="Screenshots">' +
          shot(p, "desktop", { caption: "Desktop" }) +
          shot(p, "mobile", { caption: "Phone" }) +
          "</section>"
        : "") +
      (p.url
        ? '<div class="btns"><a class="btn" href="' + esc(p.url) + '" target="_blank" rel="noopener">Visit the live site <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a></div>'
        : "") +
      '<nav class="pager section" aria-label="More projects">' +
      '<a class="prev" href="project.html?p=' + encodeURIComponent(prev.slug) + '"><small>Previous</small><b>' + esc(prev.title) + "</b></a>" +
      '<a class="next" href="project.html?p=' + encodeURIComponent(next.slug) + '"><small>Next</small><b>' + esc(next.title) + "</b></a>" +
      "</nav>";
    var h1 = out.querySelector("h1");
    if (document.activeElement === document.body || main.contains(document.activeElement)) h1.focus({ preventScroll: true });
  });

  /* ---------- about: the portrait's blue light follows you ---------- */
  Site.define("about", function (main) {
    var el = main.querySelector(".portrait");
    if (!el || Site.reducedMotion()) return;
    var lit = el.querySelector(".lit");
    function move(e) {
      var r = el.getBoundingClientRect();
      lit.style.setProperty("--mx", e.clientX - r.left + "px");
      lit.style.setProperty("--my", e.clientY - r.top + "px");
    }
    addEventListener("pointermove", move, { passive: true });
    return function () {
      removeEventListener("pointermove", move);
    };
  });

  /* ---------- contact: a small, accessible form ---------- */
  Site.define("contact", function (main) {
    var form = main.querySelector("form"),
      status = main.querySelector("[data-status]");
    if (!form) return;
    main.querySelectorAll("[data-email]").forEach(function (a) {
      a.href = "mailto:" + CONTACT.email;
      var s = a.querySelector("span");
      if (s) s.textContent = CONTACT.email;
    });
    var rules = {
      name: function (v) {
        return v.trim() ? "" : "Please tell me your name.";
      },
      email: function (v) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? "" : "Please enter an email address I can reply to.";
      },
      message: function (v) {
        return v.trim().length >= 10 ? "" : "Please write a little more (at least 10 characters).";
      },
    };
    function check(field) {
      var msg = rules[field.name] ? rules[field.name](field.value) : "",
        err = document.getElementById(field.id + "-err");
      field.setAttribute("aria-invalid", msg ? "true" : "false");
      if (err) err.textContent = msg;
      return !msg;
    }
    form.addEventListener("focusout", function (e) {
      if (rules[e.target.name] && e.target.value) check(e.target);
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var bad = null;
      Object.keys(rules).forEach(function (n) {
        var f = form.elements[n];
        if (!check(f) && !bad) bad = f;
      });
      if (bad) {
        status.textContent = "Please fix the highlighted fields.";
        bad.focus();
        return;
      }
      if (form.elements.website.value) return; // a bot filled the hidden field
      var data = {
        name: form.elements.name.value.trim(),
        email: form.elements.email.value.trim(),
        topic: form.elements.topic.value,
        message: form.elements.message.value.trim(),
      };
      if (!CONTACT.endpoint) {
        var body = data.message + "\n\n" + data.name + " (" + data.email + ")";
        location.href =
          "mailto:" + CONTACT.email + "?subject=" + encodeURIComponent(data.topic + " from " + data.name) + "&body=" + encodeURIComponent(body);
        status.textContent = "Your email app should open with the message ready to send.";
        return;
      }
      var btn = form.querySelector("[type=submit]");
      btn.disabled = true;
      status.textContent = "Sending…";
      fetch(CONTACT.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(data),
      })
        .then(function (r) {
          if (!r.ok) throw new Error(r.status);
          form.reset();
          status.textContent = "Thanks, your message is on its way. I’ll get back to you soon.";
        })
        .catch(function () {
          status.textContent = "Sorry, that didn’t send. Please email me directly at " + CONTACT.email + ".";
        })
        .then(function () {
          btn.disabled = false;
        });
    });
  });
})();
