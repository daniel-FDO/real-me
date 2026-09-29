/* =====================================================================
   CHARACTERS: three tiny original characters that live in open spaces.
   Put a placeholder in the page and this fills it in:
     <span class="char-slot" data-char="bounce"></span>  Kiki the keycap: bounces when you hover or press it
     <span class="char-slot" data-char="shy"></span>     Momo the mouse: ducks out of sight when your pointer gets close
     <span class="char-slot" data-char="alert"></span>   Tri: watches your pointer, pops a "!" when it comes near
   Kiki and Tri are real buttons (keyboard + tap work); Momo is decoration only.
   They never capture scrolling, sleep when off-screen or in a hidden tab, and
   stay still with reduced motion.
   ===================================================================== */
(function () {
  "use strict";
  var ART = {
    // a blue keycap with a face
    bounce:
      '<svg viewBox="0 0 64 64" aria-hidden="true">' +
      '<ellipse class="ch-shadow" cx="32" cy="60" rx="17" ry="3"/>' +
      '<g class="ch-body">' +
      '<rect x="9" y="14" width="46" height="42" rx="11" class="ch-fill" style="fill:var(--ch-blue)"/>' +
      '<rect x="14" y="17" width="36" height="30" rx="8" class="ch-face" style="fill:var(--ch-blue-top)"/>' +
      '<g class="ch-eyes"><ellipse cx="25" cy="30" rx="3.2" ry="4"/><ellipse cx="39" cy="30" rx="3.2" ry="4"/></g>' +
      '<path class="ch-mouth" d="M27 37 q5 4 10 0"/>' +
      '<circle class="ch-blush" cx="19.5" cy="36" r="2.6"/><circle class="ch-blush" cx="44.5" cy="36" r="2.6"/>' +
      "</g></svg>",
    // a pink computer mouse with a scroll wheel, peeking over an edge
    shy:
      '<svg viewBox="0 0 64 64" aria-hidden="true">' +
      '<g class="ch-body">' +
      '<path class="ch-fill" style="fill:var(--ch-pink)" d="M12 64 V30 a20 20 0 0 1 40 0 V64 z"/>' +
      '<path class="ch-line" d="M32 11 v12"/><rect x="29" y="15" width="6" height="9" rx="3" class="ch-wheel"/>' +
      '<g class="ch-eyes"><ellipse cx="24.5" cy="36" rx="3" ry="3.8"/><ellipse cx="39.5" cy="36" rx="3" ry="3.8"/></g>' +
      '<circle class="ch-blush" cx="19" cy="43" r="3"/><circle class="ch-blush" cx="45" cy="43" r="3"/>' +
      '<path class="ch-mouth" d="M29.5 44 q2.5 2 5 0"/>' +
      "</g></svg>",
    // a yellow triangle with an antenna and eyes that follow you
    alert:
      '<svg viewBox="0 0 64 64" aria-hidden="true">' +
      '<ellipse class="ch-shadow" cx="32" cy="61" rx="18" ry="2.6"/>' +
      '<g class="ch-body">' +
      '<path class="ch-line" d="M32 8 V2"/><circle cx="32" cy="2.5" r="2.6" class="ch-fill" style="fill:var(--ch-mint)"/>' +
      '<path class="ch-fill" style="fill:var(--ch-yellow)" d="M32 8 L58 54 a4 4 0 0 1 -3.5 6 H9.5 a4 4 0 0 1 -3.5 -6 z"/>' +
      '<g class="ch-eyes"><circle cx="25" cy="39" r="5.2" class="ch-white"/><circle cx="39" cy="39" r="5.2" class="ch-white"/>' +
      '<g class="ch-pupils"><circle cx="25" cy="39" r="2.4"/><circle cx="39" cy="39" r="2.4"/></g></g>' +
      '<path class="ch-mouth" d="M29 50 h6"/>' +
      "</g>" +
      '<g class="ch-bang"><rect x="47" y="0" width="15" height="19" rx="7.5" class="ch-bubble"/><path d="M54.5 4.5 v6" class="ch-bang-line"/><circle cx="54.5" cy="14.2" r="1.3" class="ch-bang-dot"/></g>' +
      "</svg>",
  };
  var LABEL = {
    bounce: "Kiki the keycap. Press to make it bounce",
    alert: "Tri. Press to startle it",
  };
  function mount(root) {
    var slots = [].slice.call((root || document).querySelectorAll("[data-char]"));
    if (!slots.length) return null;
    var RM = matchMedia("(prefers-reduced-motion: reduce)").matches,
      chars = [],
      off = new AbortController(),
      on = { signal: off.signal };
    slots.forEach(function (slot) {
      var kind = slot.dataset.char,
        el;
      if (!ART[kind]) return;
      if (LABEL[kind]) {
        el = document.createElement("button");
        el.type = "button";
        el.setAttribute("aria-label", LABEL[kind]);
      } else {
        el = document.createElement("span");
        el.setAttribute("aria-hidden", "true");
      }
      el.className = "ch ch-" + kind;
      el.innerHTML = ART[kind];
      slot.appendChild(el);
      var c = { kind: kind, el: el, slot: slot, visible: true, near: false, timer: 0 };
      chars.push(c);
      // press / tap: its own little reaction (never passes the press on to the page)
      if (kind !== "shy")
        el.addEventListener(
          "click",
          function (e) {
            e.stopPropagation();
            react(c);
          },
          on,
        );
      el.addEventListener("pointerdown", function (e) {
        e.stopPropagation(); // e.g. the welcome screen's press-and-hold never sees it
      }, on);
      if (kind === "bounce")
        el.addEventListener(
          "pointerenter",
          function (e) {
            if (e.pointerType === "mouse") react(c);
          },
          on,
        );
    });
    function replay(el, cls) {
      el.classList.remove(cls);
      void el.offsetWidth; // restart the CSS animation
      el.classList.add(cls);
    }
    function react(c) {
      if (RM) return;
      if (c.kind === "bounce") replay(c.el, "is-jump");
      if (c.kind === "alert") replay(c.el, "is-startled");
    }
    // pointer proximity: Momo ducks, Tri watches and gets alert (one listener, one frame at a time)
    var px = -1e4,
      py = -1e4,
      queued = false;
    function frame() {
      queued = false;
      chars.forEach(function (c) {
        if (!c.visible || document.hidden) return;
        var r = c.el.getBoundingClientRect(),
          cx = r.left + r.width / 2,
          cy = r.top + r.height / 2,
          dx = px - cx,
          dy = py - cy,
          d = Math.hypot(dx, dy);
        if (c.kind === "shy") {
          var near = d < 150;
          if (near !== c.near) {
            c.near = near;
            clearTimeout(c.timer);
            if (near) c.el.classList.add("is-hiding");
            // peeks back a moment after you move away
            else
              c.timer = setTimeout(function () {
                c.el.classList.remove("is-hiding");
              }, 900);
          }
        } else if (c.kind === "alert") {
          // pupils look toward the pointer (a few pixels at most)
          var k = Math.min(1, d / 240);
          c.el.style.setProperty("--lx", ((dx / (d || 1)) * 2.4 * k).toFixed(2));
          c.el.style.setProperty("--ly", ((dy / (d || 1)) * 2.4 * k).toFixed(2));
          var close = d < 170;
          if (close && !c.near) replay(c.el, "is-startled");
          c.near = close;
          c.el.classList.toggle("is-alert", close);
        }
      });
    }
    if (!RM)
      addEventListener(
        "pointermove",
        function (e) {
          if (e.pointerType !== "mouse") return;
          px = e.clientX;
          py = e.clientY;
          if (!queued) {
            queued = true;
            requestAnimationFrame(frame);
          }
        },
        Object.assign({ passive: true }, on),
      );
    // off-screen or hidden tab: idle animations pause
    var io =
      "IntersectionObserver" in window
        ? new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
              chars.forEach(function (c) {
                if (c.slot === e.target) {
                  c.visible = e.isIntersecting;
                  c.el.classList.toggle("is-paused", !e.isIntersecting);
                }
              });
            });
          })
        : null;
    chars.forEach(function (c) {
      if (io) io.observe(c.slot);
    });
    function onVis() {
      chars.forEach(function (c) {
        c.el.classList.toggle("is-paused", document.hidden || !c.visible);
      });
    }
    document.addEventListener("visibilitychange", onVis, on);
    return function () {
      off.abort();
      if (io) io.disconnect();
      chars.forEach(function (c) {
        clearTimeout(c.timer);
      });
    };
  }
  window.Characters = { mount: mount };
})();
