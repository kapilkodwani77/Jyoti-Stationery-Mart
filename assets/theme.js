/* MamaJoy theme.js — vanilla, no dependencies, deferred load.
   Every module guards on element existence so this one file is safe
   to include on every template. Scoped by data-attribute, not id,
   so nothing breaks if a section is ever duplicated. */
(function () {
  'use strict';

  var RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var routes = window.themeRoutes || { cartAdd: '/cart/add.js', cartChange: '/cart/change.js', cart: '/cart.js', root: '/' };

  /* ---------------------------------------------------------------
     Design-mode flag (theme editor) — lets .bc-todo show only there
  --------------------------------------------------------------- */
  if (window.Shopify && Shopify.designMode) {
    document.documentElement.setAttribute('data-design-mode', '');
  }

  /* ---------------------------------------------------------------
     Reveal on scroll
  --------------------------------------------------------------- */
  (function reveals() {
    var els = document.querySelectorAll('[data-reveal]');
    if (!els.length) return;
    if (RM) { els.forEach(function (e) { e.classList.add('in'); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.15 });
    els.forEach(function (e) { io.observe(e); });
  })();

  /* ---------------------------------------------------------------
     Header: solid on scroll, mobile nav overlay
  --------------------------------------------------------------- */
  /* Shared elevation for the pinned masthead. One class on the wrapper, so the
     announcement bar and the header lift together and can never disagree about
     whether the page has moved. rAF-throttled and passive: this runs on every
     scroll frame on the longest page in the theme. */
  (function masthead() {
    var el = document.querySelector('[data-masthead]');
    if (!el) return;
    var ticking = false;
    function paint() {
      ticking = false;
      el.classList.toggle('is-pinned', window.scrollY > 0);
    }
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(paint);
    }, { passive: true });
    paint();
  })();

  (function header() {
    var hdr = document.querySelector('[data-header]');
    if (!hdr) return;

    var hero = document.querySelector('.hero');
    if (hero) {
      var io = new IntersectionObserver(function (entries) {
        hdr.classList.toggle('is-solid', !entries[0].isIntersecting);
      }, { threshold: 0, rootMargin: '-1px 0px 0px 0px' });
      io.observe(hero);
    } else {
      hdr.classList.add('is-solid');
    }

    var burger = document.querySelector('[data-nav-open]');
    var overlay = document.querySelector('[data-nav-overlay]');
    var closeBtn = document.querySelector('[data-nav-close]');
    if (!burger || !overlay) return;

    var lastFocus;
    function trap(e) {
      if (e.key !== 'Tab') return;
      var f = overlay.querySelectorAll('a,button');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    }
    function open() {
      lastFocus = document.activeElement;
      overlay.classList.add('on');
      document.body.classList.add('nav-open');
      overlay.querySelector('a,button').focus();
      document.addEventListener('keydown', onKey);
    }
    function close() {
      overlay.classList.remove('on');
      document.body.classList.remove('nav-open');
      document.removeEventListener('keydown', onKey);
      if (lastFocus) lastFocus.focus();
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
      trap(e);
    }
    burger.addEventListener('click', open);
    if (closeBtn) closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
  })();

  /* ---------------------------------------------------------------
     Sticky buy bar
     Shows once [data-buybar-anchor] scrolls out of view.
     Hides again once [data-buybar-hide] scrolls into view.

     This governs desktop, and every template that is not the PDP. On the
     product page below 900px the bar is permanent, and that is stated in CSS
     rather than here so it paints with the first stylesheet and survives this
     script never running. The toggling below still happens there and lands on
     the same values, so the two never contradict each other.
  --------------------------------------------------------------- */
  (function buybar() {
    var bar = document.querySelector('[data-buybar]');
    if (!bar) return;

    /* What the bar waits for. An explicit [data-buybar-anchor] wins; where a
       template never declared one, the buy box is the right answer by
       definition, because replacing it once it scrolls away is the whole job.

       The fallback exists because the early return here is a silent failure:
       the layout has always rendered this bar on every page, and the product
       template simply had no anchor, so the module returned and the bar sat
       inert with nothing to show for it. One missing attribute on one template
       should not be able to switch off a purchase control.

       bar.contains guards the fallback against matching the bar's own form,
       which would leave it observing an element that is only ever on screen
       when the bar already is. */
    var anchor = document.querySelector('[data-buybar-anchor]') ||
                 document.querySelector('[data-buybox]');
    if (!anchor || bar.contains(anchor)) return;

    var hideEl = document.querySelector('[data-buybar-hide]');
    var pastAnchor = false, atHide = false;

    function paint() { bar.classList.toggle('on', pastAnchor && !atHide); }

    /* Shopify's theme-preview chrome is a bar pinned to the bottom edge at a
       z-index nothing in a theme can outrank, and it is very close to this
       bar's own height — so at bottom:0 the buy bar paints correctly and is
       completely hidden behind it on every preview link. It is injected by
       Shopify, never ships to a live storefront, and is absent in production,
       where this measures 0 and the rule is inert. */
    function lift() {
      var chrome = document.querySelector('#preview-bar-iframe, [id^="preview-bar"]');
      if (!chrome) { bar.style.setProperty('--buybar-lift', '0px'); return; }
      /* Measured from the chrome's top edge to the bottom of the viewport
         rather than from its own height, so it is expressed in the same
         coordinate space `bottom` resolves against. Plus one small step, so
         the two bars read as separate objects instead of one seam. */
      var r = chrome.getBoundingClientRect();
      var h = Math.max(0, Math.round(window.innerHeight - r.top)) + 8;
      bar.style.setProperty('--buybar-lift', h + 'px');
    }
    lift();
    /* The preview bar is injected after the theme's own scripts run, so the
       first measurement can legitimately be zero. */
    window.addEventListener('load', lift);
    window.addEventListener('resize', lift);

    /* Past, not merely absent — and read rather than observed.

       "Have we left the buy box behind" has three answers: it is above the
       viewport, inside it, or still below it. IntersectionObserver reports two,
       and deriving the third from boundingClientRect only works while every
       transition passes through the intersecting state. Jump from below the buy
       box to above it in one frame — scroll restoration, an in-page anchor, any
       programmatic scrollTo — and isIntersecting is false on both sides, so no
       notification is delivered at all and the bar holds whatever it had. On the
       immersive gallery the buy box now starts below the fold, which makes that
       stale state "bar showing on a page you just returned to the top of".

       One rect read, throttled to a frame and passive, cannot go stale. */
    var ticking = false;
    function measure() {
      ticking = false;
      pastAnchor = anchor.getBoundingClientRect().bottom <= 0;
      paint();
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(measure);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    measure();

    if (hideEl) {
      /* threshold 0, not 0.25. The requirement is "stand down as the footer
         arrives", and a ratio threshold on an element whose height depends on
         how many link columns a merchant configured fires at a different
         scroll position on every page — and on a footer taller than four
         viewports it can never be reached at all, which would leave the bar
         sitting over the footer forever. */
      new IntersectionObserver(function (entries) {
        atHide = entries[0].isIntersecting;
        paint();
      }, { threshold: 0 }).observe(hideEl);
    }
  })();

  /* ---------------------------------------------------------------
     Sticky bar <- buy box: two buttons, one decision
  --------------------------------------------------------------- */
  /* The bar is permanent on mobile now, so for the first time both add-to-cart
     controls are on screen together, and the bar's own hidden inputs — quantity
     1, the variant that was selected when the page rendered — became a way to
     silently ignore the shopper. Set the stepper to 3 and tap the footer, and
     the old build added 1.

     A mirror rather than a shared form: the two are separate forms in separate
     places in the DOM, the delegated submit handler reads whichever form was
     submitted, and pointing the footer at the buy box's fields would mean
     hoisting one of them out of the section it belongs to. The stepper
     dispatches a bubbling change and typing fires input, so listening on the
     buy box covers every path either control has.

     Its own module, not part of buybar() above, because that one returns early
     when there is no scroll anchor and this has nothing to do with scrolling. */
  (function buybarMirror() {
    var barForm = document.querySelector('[data-buybar] [data-buybox-form]');
    var box = document.querySelector('[data-buybox]');
    if (!barForm || !box || box.contains(barForm)) return;

    var srcQty = box.querySelector('[data-qty-input]');
    var srcId = box.querySelector('[data-variant-id]');
    var dstQty = barForm.querySelector('[name="quantity"]');
    var dstId = barForm.querySelector('[name="id"]');

    function sync() {
      if (srcQty && dstQty) {
        var q = parseInt(srcQty.value, 10);
        dstQty.value = isNaN(q) || q < 1 ? 1 : q;
      }
      if (srcId && dstId && srcId.value) dstId.value = srcId.value;
    }
    sync();
    box.addEventListener('input', sync);
    box.addEventListener('change', sync);
  })();

  /* ---------------------------------------------------------------
     PDP in-page nav. Built from whatever sections below carry
     data-jump, so it always matches the sections a merchant actually
     placed rather than a list hardcoded against one template.
  --------------------------------------------------------------- */
  (function pdpJump() {
    var nav = document.querySelector('[data-pdp-jump]');
    if (!nav) return;

    var targets = Array.prototype.slice.call(document.querySelectorAll('[data-jump]'))
      .filter(function (el) { return el.id && el.dataset.jump.trim(); });
    /* One chip is not a nav, it is a stray button — the page has to be long
       enough for orientation to be worth the row. */
    if (targets.length < 2) return;

    var list = document.createElement('ul');
    list.className = 'pdp-jump-list';

    var links = targets.map(function (el) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.className = 'pdp-jump-link';
      a.href = '#' + el.id;
      a.textContent = el.dataset.jump.trim();
      li.appendChild(a);
      list.appendChild(li);
      return a;
    });

    nav.appendChild(list);
    nav.hidden = false;

    /* Which section you are in, marked as you scroll. aria-current rather than
       a class alone, so the state is available to a screen reader running the
       nav rather than only to someone watching it. */
    var current = null;
    var mark = function (el) {
      if (el === current) return;
      current = el;
      links.forEach(function (a) {
        var on = a.getAttribute('href') === '#' + el.id;
        a.classList.toggle('is-current', on);
        if (on) {
          a.setAttribute('aria-current', 'true');
          /* Keep the active chip in view on mobile, where the row scrolls.
             Deliberately not scrollIntoView: the nav sits in the flow rather
             than pinned, so once the reader is deep in the page that call
             would drag the whole document back up to it. Scrolling the strip
             directly can only ever move the strip. */
          if (list.scrollWidth > list.clientWidth) {
            var want = a.offsetLeft - (list.clientWidth - a.offsetWidth) / 2;
            var max = list.scrollWidth - list.clientWidth;
            list.scrollTo({
              left: Math.max(0, Math.min(want, max)),
              behavior: RM ? 'auto' : 'smooth'
            });
          }
        } else {
          a.removeAttribute('aria-current');
        }
      });
    };

    /* Top band only: a section counts as current once its start crosses under
       the header, which is what a reader means by "where am I" — not whichever
       section happens to occupy the most pixels. */
    var jumpObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) mark(e.target); });
    }, { rootMargin: '-20% 0px -70% 0px' });
    targets.forEach(function (t) { jumpObserver.observe(t); });
  })();

  /* ---------------------------------------------------------------
     04 — Fold scroll-scrub, degrades to static 2x2 grid
  --------------------------------------------------------------- */
  (function fold() {
    var tracks = document.querySelectorAll('[data-fold-track]');
    if (!tracks.length) return;
    var lowEnd = (navigator.connection && navigator.connection.saveData) ||
                 (navigator.deviceMemory && navigator.deviceMemory < 4);
    if (RM || lowEnd) return;

    tracks.forEach(function (track) {
      track.classList.add('is-scrub');
      var figs = track.querySelectorAll('[data-fold-fig]');
      var rail = track.querySelectorAll('[data-fold-rail] span');
      var active = 0, ticking = false, live = false;

      function paint() {
        ticking = false;
        var r = track.getBoundingClientRect(), vh = window.innerHeight;
        var p = (-r.top) / (r.height - vh);
        p = p < 0 ? 0 : p > 1 ? 1 : p;
        var i = Math.min(figs.length - 1, Math.floor(p * figs.length));
        if (i !== active) {
          figs[active].classList.remove('on'); if (rail[active]) rail[active].classList.remove('on');
          figs[i].classList.add('on'); if (rail[i]) rail[i].classList.add('on');
          active = i;
        }
      }
      function onScroll() { if (!ticking && live) { ticking = true; requestAnimationFrame(paint); } }
      new IntersectionObserver(function (entries) {
        live = entries[0].isIntersecting;
        if (live) { window.addEventListener('scroll', onScroll, { passive: true }); paint(); }
        else { window.removeEventListener('scroll', onScroll); }
      }, { threshold: 0 }).observe(track);
    });
  })();

  /* ---------------------------------------------------------------
     05 — Room test before/after slider
  --------------------------------------------------------------- */
  (function roomTest() {
    document.querySelectorAll('[data-room-test]').forEach(function (rt) {
      var range = rt.querySelector('[data-rt-range]');
      if (!range) return;
      function setPos(v) {
        rt.style.setProperty('--pos', v);
        range.setAttribute('aria-valuetext', v + '% with the mat');
      }
      range.addEventListener('input', function () { setPos(this.value); });

      if (!RM) {
        new IntersectionObserver(function (entries, obs) {
          if (!entries[0].isIntersecting) return;
          obs.disconnect();
          var t0 = performance.now();
          (function step(t) {
            var p = Math.min(1, (t - t0) / 900);
            var e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
            var v = Math.round(50 + Math.sin(e * Math.PI) * 15);
            range.value = v; setPos(v);
            if (p < 1) requestAnimationFrame(step);
          })(t0);
        }, { threshold: 0.4 }).observe(rt);
      }
    });
  })();

  /* ---------------------------------------------------------------
     07 — Fit comparator radiogroup
  --------------------------------------------------------------- */
  (function fit() {
    document.querySelectorAll('[data-fit-comparator]').forEach(function (root) {
      var chips = Array.prototype.slice.call(root.querySelectorAll('[data-fit-chip]'));
      var caption = root.querySelector('[data-fit-caption]');
      var svg = root.querySelector('[data-fit-svg]');
      if (!chips.length) return;

      function pick(btn) {
        chips.forEach(function (c) {
          var on = c === btn;
          c.setAttribute('aria-checked', on);
          var g = root.querySelector('[data-fit-group="' + c.dataset.fitChip + '"]');
          if (g) g.classList.toggle('on', on);
        });
        if (caption) caption.textContent = btn.dataset.fitCaption || '';
        if (svg) svg.setAttribute('aria-label', btn.dataset.fitLabel || '');
      }
      chips.forEach(function (c, i) {
        c.addEventListener('click', function () { pick(c); });
        c.addEventListener('keydown', function (e) {
          var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
          if (!d) return;
          e.preventDefault();
          var next = chips[(i + d + chips.length) % chips.length];
          next.focus(); pick(next);
        });
      });
    });
  })();

  /* ---------------------------------------------------------------
     PDP gallery: scroll-snap strip synced to thumbs/dots, plus the
     full-screen zoom viewer the slides open into.
  --------------------------------------------------------------- */
  (function gallery() {
    document.querySelectorAll('[data-gallery]').forEach(function (root) {
      var main = root.querySelector('[data-gallery-main]');
      var slides = Array.prototype.slice.call(root.querySelectorAll('[data-gallery-slide]'));
      var thumbs = Array.prototype.slice.call(root.querySelectorAll('[data-gallery-thumb]'));
      var dots = Array.prototype.slice.call(root.querySelectorAll('[data-gallery-dot]'));
      if (!main) return;

      var goTo = function () {};

      if (slides.length > 1) {
        var setActive = function (i) {
          /* aria-current alongside the class: the active state was purely
             visual, so a screen reader running down the thumb or dot buttons
             heard six identical-sounding controls with nothing marking which
             image is actually on screen. */
          var mark = function (el, on) {
            el.classList.toggle('is-active', on);
            if (on) el.setAttribute('aria-current', 'true');
            else el.removeAttribute('aria-current');
          };
          thumbs.forEach(function (t, idx) { mark(t, idx === i); });
          dots.forEach(function (d, idx) { mark(d, idx === i); });
        };
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) setActive(slides.indexOf(e.target));
          });
        }, { root: main, threshold: 0.6 });
        slides.forEach(function (s) { io.observe(s); });

        goTo = function (i) {
          if (!slides[i]) return;
          slides[i].scrollIntoView({ behavior: RM ? 'auto' : 'smooth', inline: 'start', block: 'nearest' });
        };
        thumbs.forEach(function (t, i) { t.addEventListener('click', function () { goTo(i); }); });
        dots.forEach(function (d, i) { d.addEventListener('click', function () { goTo(i); }); });
      }

      /* ---- full-screen zoom viewer ------------------------------------
         Product photography is the whole argument on a PDP and the slide
         is barely 55vw wide — stitching, print quality and safety marks
         are all below the resolution the page ships. The viewer is the
         one place the 2048px source is worth its bytes, so nothing
         fetches it until someone actually asks. */
      var triggers = Array.prototype.slice.call(root.querySelectorAll('[data-zoom-open]'));
      var lb = (root.closest('.shopify-section') || document).querySelector('[data-zoom]');
      if (!lb || !triggers.length) return;

      var stage = lb.querySelector('[data-zoom-stage]');
      var img = lb.querySelector('[data-zoom-img]');
      var countEl = lb.querySelector('[data-zoom-count]');
      var toggleBtn = lb.querySelector('[data-zoom-toggle]');
      var closeBtn = lb.querySelector('[data-zoom-close]');
      var prevBtn = lb.querySelector('[data-zoom-prev]');
      var nextBtn = lb.querySelector('[data-zoom-next]');
      if (!stage || !img) return;

      var index = 0;
      var zoomed = false;
      var lastFocus = null;

      img.addEventListener('load', function () { lb.classList.remove('is-loading'); });
      /* A dead source must not leave the spinner turning forever. */
      img.addEventListener('error', function () { lb.classList.remove('is-loading'); });

      function unzoom() {
        zoomed = false;
        lb.classList.remove('is-zoomed', 'is-panning');
        img.style.width = '';
        img.style.height = '';
        stage.scrollLeft = 0;
        stage.scrollTop = 0;
        toggleBtn.setAttribute('aria-pressed', 'false');
        toggleBtn.setAttribute('aria-label', 'Zoom in');
      }

      /* Magnify far enough to reach the pixels the source actually has, but
         stay inside a 2x-3x band so the step is always a visible change and
         never a wall of blur. */
      function factor() {
        var fitted = img.getBoundingClientRect().width;
        if (!fitted) return 2;
        return Math.min(3, Math.max(2, (img.naturalWidth || fitted * 2) / fitted));
      }

      /* cx/cy is the point that must not move: the pixel under the finger,
         or the centre of the stage when the toolbar button is used. */
      function zoomTo(cx, cy) {
        var r = img.getBoundingClientRect();
        if (!r.width || !r.height) return;
        var ox = (cx - r.left) / r.width;
        var oy = (cy - r.top) / r.height;
        var f = factor();

        zoomed = true;
        lb.classList.add('is-zoomed');
        toggleBtn.setAttribute('aria-pressed', 'true');
        toggleBtn.setAttribute('aria-label', 'Zoom out');
        img.style.width = r.width * f + 'px';
        img.style.height = r.height * f + 'px';

        /* Re-measure rather than predicting the new geometry: the stage has
           padding and the image is centred with auto margins until it
           outgrows the stage, and reading the real rect back is exact where
           arithmetic over those would not be. Overscroll clamps itself. */
        var r2 = img.getBoundingClientRect();
        stage.scrollLeft += (r2.left + ox * r2.width) - cx;
        stage.scrollTop += (r2.top + oy * r2.height) - cy;
      }

      function preload(i) {
        var t = triggers[(i + triggers.length) % triggers.length];
        var url = t && t.getAttribute('data-zoom-src');
        if (url) { var p = new Image(); p.src = url; }
      }

      function show(i) {
        index = (i + triggers.length) % triggers.length;
        var t = triggers[index];
        unzoom();
        lb.classList.add('is-loading');
        /* Deliberately no width/height attributes: those map to CSS width and
           height, and once both axes are set explicitly max-width and
           max-height clamp them independently rather than as a ratio — the
           image ends up stretched to the stage. Letting the loaded source
           supply the intrinsic size keeps the contain behaviour honest, and
           the spinner covers the gap. */
        img.alt = t.getAttribute('data-zoom-alt') || '';
        img.src = t.getAttribute('data-zoom-src');
        if (countEl) countEl.textContent = (index + 1) + ' of ' + triggers.length;
        if (triggers.length > 1) { preload(index + 1); preload(index - 1); }
      }

      function focusables() {
        return Array.prototype.slice.call(lb.querySelectorAll('button,[tabindex]'))
          .filter(function (el) { return el.offsetWidth > 0 || el.offsetHeight > 0; });
      }
      function trap(e) {
        var f = focusables();
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
        else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (e.key === 'Tab') { trap(e); return; }
        /* While magnified the arrows belong to the pan surface — the stage is
           a real scroll container, so leaving the event alone pans it. */
        if (zoomed || triggers.length < 2) return;
        if (e.key === 'ArrowRight') { e.preventDefault(); show(index + 1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); show(index - 1); }
      }

      function open(i) {
        lastFocus = document.activeElement;
        lb.hidden = false;
        document.body.classList.add('zoom-open');
        show(i);
        closeBtn.focus();
        document.addEventListener('keydown', onKey);
      }
      function close() {
        document.removeEventListener('keydown', onKey);
        unzoom();
        lb.hidden = true;
        document.body.classList.remove('zoom-open');
        /* Drop the 2048px bitmap and abandon any load still in flight. */
        img.removeAttribute('src');
        lb.classList.remove('is-loading');
        /* Land the strip on whichever image was last being viewed, so closing
           never teleports you back to where you started. */
        goTo(index);
        var back = triggers[index] || lastFocus;
        if (back && back.focus) back.focus({ preventScroll: true });
      }

      triggers.forEach(function (t, i) {
        var px = 0, py = 0;
        t.addEventListener('pointerdown', function (e) { px = e.clientX; py = e.clientY; });
        t.addEventListener('click', function (e) {
          /* A swipe across the strip ends on whichever slide it started from;
             that is navigation, not a request to open it. detail === 0 marks
             a keyboard activation, which has no coordinates to compare. */
          if (e.detail !== 0 && (Math.abs(e.clientX - px) > 10 || Math.abs(e.clientY - py) > 10)) return;
          e.preventDefault();
          open(i);
        });
      });

      closeBtn.addEventListener('click', close);
      toggleBtn.addEventListener('click', function () {
        if (zoomed) { unzoom(); return; }
        var s = stage.getBoundingClientRect();
        zoomTo(s.left + s.width / 2, s.top + s.height / 2);
      });
      if (prevBtn) prevBtn.addEventListener('click', function () { show(index - 1); });
      if (nextBtn) nextBtn.addEventListener('click', function () { show(index + 1); });

      /* Mouse drag panning. Touch is left to native overflow scrolling —
         capturing the pointer there would trade momentum and rubber-banding
         for a worse hand-rolled copy of both. */
      var dragging = false, sx = 0, sy = 0, sl = 0, st = 0, moved = false;
      stage.addEventListener('pointerdown', function (e) {
        moved = false;
        if (e.pointerType !== 'mouse' || !zoomed) return;
        dragging = true;
        sx = e.clientX; sy = e.clientY;
        sl = stage.scrollLeft; st = stage.scrollTop;
        lb.classList.add('is-panning');
        stage.setPointerCapture(e.pointerId);
      });
      stage.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        var dx = e.clientX - sx, dy = e.clientY - sy;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
        stage.scrollLeft = sl - dx;
        stage.scrollTop = st - dy;
      });
      function endDrag(e) {
        if (!dragging) return;
        dragging = false;
        lb.classList.remove('is-panning');
        if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
      }
      stage.addEventListener('pointerup', endDrag);
      stage.addEventListener('pointercancel', endDrag);

      stage.addEventListener('click', function (e) {
        /* The click that ends a drag is the drag, not a separate tap. */
        if (moved) { moved = false; return; }
        if (e.target === img) {
          if (zoomed) unzoom(); else zoomTo(e.clientX, e.clientY);
        } else {
          close();
        }
      });

      /* The magnified size is stored in pixels, so a rotation or a resized
         window would leave it describing a viewport that no longer exists. */
      window.addEventListener('resize', function () { if (!lb.hidden && zoomed) unzoom(); });
    });
  })();

  /* ---------------------------------------------------------------
     Quantity steppers (buy box + cart drawer + cart page)
  --------------------------------------------------------------- */
  document.addEventListener('click', function (e) {
    var minus = e.target.closest('[data-qty-minus]');
    var plus = e.target.closest('[data-qty-plus]');
    if (!minus && !plus) return;
    var wrap = e.target.closest('[data-qty-stepper]');
    var input = wrap.querySelector('[data-qty-input],input[type="number"]');
    if (!input) return;
    /* isNaN rather than `|| fallback`: every one of these is a number for
       which 0 is a legitimate value, and `parseInt("0") || 1` is 1. Both the
       drawer line and the cart page declare min="0" so the last unit can be
       stepped away, and this quietly clamped them to 1 — the minus button
       contradicted the range its own markup advertised. */
    var min = parseInt(input.min, 10); if (isNaN(min)) min = 1;
    var max = parseInt(input.max, 10); if (isNaN(max)) max = 99;
    var val = parseInt(input.value, 10); if (isNaN(val)) val = min;
    val = minus ? Math.max(min, val - 1) : Math.min(max, val + 1);
    input.value = val;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  /* ---------------------------------------------------------------
     Cart drawer: open/close, render, AJAX add / change / remove
  --------------------------------------------------------------- */
  var drawer = document.querySelector('[data-cart-drawer]');
  var scrim = document.querySelector('[data-cart-scrim]');

  /* Cart state changes were previously silent to assistive tech: the badge,
     the line list and the subtotal all updated visually with nothing
     announced. One polite live region, fed from the two functions that own
     every cart mutation, covers add / remove / quantity / errors. */
  var announcer = document.getElementById('cart-live');
  if (!announcer) {
    announcer = document.createElement('p');
    announcer.id = 'cart-live';
    announcer.className = 'visually-hidden';
    announcer.setAttribute('role', 'status');
    announcer.setAttribute('aria-live', 'polite');
    document.body.appendChild(announcer);
  }
  function announce(msg) {
    // Re-set to '' first so repeating the same message still fires.
    announcer.textContent = '';
    window.setTimeout(function () { announcer.textContent = msg; }, 40);
  }

  /* Cart line markup is built as an HTML string, so every value interpolated
     into it has to be escaped. product_title is merchant-controlled and comes
     back from /cart.js as raw text. */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function updateBadges(count) {
    document.querySelectorAll('[data-cart-count]').forEach(function (b) {
      /* State indication, not decoration: the badge is the only confirmation an
         add landed, and a silent number swap is the one moment in the flow with
         no feedback. Only on a real change, so re-renders that leave the count
         alone stay still. The class is removed before it is re-added so two
         adds in quick succession each get their own beat instead of the second
         being swallowed by the first. CSS owns the timing and the
         reduced-motion opt-out. */
      var changed = b.textContent !== String(count);
      b.textContent = count;
      b.hidden = count === 0;
      if (changed && count > 0 && !RM) {
        b.classList.remove('is-bumped');
        void b.offsetWidth;
        b.classList.add('is-bumped');
      }
    });
    document.querySelectorAll('[data-cart-open]').forEach(function (b) {
      b.setAttribute('aria-label', count === 1 ? 'Open cart, 1 item'
                                               : 'Open cart, ' + count + ' items');
    });
  }

  function money(cents) {
    return '₹' + (cents / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }

  /* /cart.js hands back the original upload URL, so every drawer render was
     pulling a full-resolution product photo through a 72px box — the same
     pipeline bypass the cart page had in Liquid. Shopify's CDN resizes on
     request. Any width already on the URL is stripped first so ours is the
     only one that can apply. */
  function cdnImg(url, w) {
    if (!url) return '';
    var clean = String(url)
      .replace(/([?&])width=\d+&?/g, '$1')
      .replace(/[?&]$/, '');
    return clean + (clean.indexOf('?') === -1 ? '?' : '&') + 'width=' + w;
  }

  /* ---------------------------------------------------------------
     MRP — the one number the cart needs that /cart.js does not carry

     Shopify's AJAX cart has no compare_at_price. Liquid does, so the drawer
     seeds this cache with the compare-at for everything in the cart at render
     time and the script fetches /products/{handle}.js once for anything added
     afterwards. Between them every line has its real MRP without the struck
     figure ever flickering out on an AJAX repaint, which is what made the
     previous implementation settle for original_price and report a saving of
     nothing on a product genuinely 601 off.

     This is display metadata and is kept strictly to one side of the cart:
     nothing here feeds a quantity, a total or a mutation. A failed or missing
     lookup costs a strikethrough. It cannot cost cart state, and it cannot
     make the cart claim a price Shopify did not send.

     A value of 0 means "asked, and there is no compare-at" — a real answer,
     cached so it is not asked again. undefined means not yet known. */
  var mrpCache = {};
  var mrpPending = {};
  var lastCart = null;

  (function seedMrp() {
    var el = document.querySelector('[data-cart-mrp-seed]');
    if (!el) return;
    try {
      var seed = JSON.parse(el.textContent || '{}');
      Object.keys(seed).forEach(function (k) { mrpCache[k] = Number(seed[k]) || 0; });
    } catch (e) {
      /* A malformed seed costs the strikethrough on first paint and nothing
         else — the fetch below still fills the cache in. */
    }
  })();

  /* The MRP for one line, or 0 where there is honestly none to show.

     Conservative on purpose, and in the same order as the Liquid: a compare-at
     only counts when it is genuinely above what is being charged. Blank, zero,
     equal and lower all fall through, and a line the shopper is getting free —
     final_price 0 — is exactly the case a loose rule turns into an invented
     discount. A struck price is a factual claim about what this cost before;
     the theme would rather say nothing than manufacture one. */
  function mrpFor(item) {
    var known = mrpCache[item.variant_id];
    if (typeof known === 'number' && known > item.final_price) return known;
    if (item.original_price > item.final_price) return item.original_price;
    return 0;
  }

  /* Sum of each line's MRP times its quantity. Lines with no MRP contribute
     what the shopper actually pays, so this can never come out under the cart
     total and hand the summary a negative saving to render. */
  function mrpTotal(cart) {
    var total = 0;
    cart.items.forEach(function (item) {
      var m = mrpFor(item);
      total += (m > 0 ? m : item.final_price) * item.quantity;
    });
    return total < cart.total_price ? cart.total_price : total;
  }

  /* Fills gaps in the cache, then repaints through applyCart — the single
     writer, called with the cart already on screen, so this adds a paint and
     never a second source of cart truth.

     It cannot recurse: every path through the response marks the variant known,
     so the next pass returns early for it. */
  function ensureMrp(cart) {
    cart.items.forEach(function (item) {
      if (typeof mrpCache[item.variant_id] === 'number') return;
      var handle = item.handle;
      if (!handle || mrpPending[handle]) return;
      mrpPending[handle] = true;

      cartRequest(routes.root + 'products/' + handle + '.js')
        .then(function (res) {
          var variants = (res.ok && res.data && res.data.variants) || [];
          variants.forEach(function (v) {
            mrpCache[v.id] = Number(v.compare_at_price) || 0;
          });
          /* Whatever came back, this variant is now answered. Without this a
             response that somehow omits it would leave it forever unknown and
             re-requested on every paint. */
          if (typeof mrpCache[item.variant_id] !== 'number') mrpCache[item.variant_id] = 0;
          if (lastCart) applyCart(lastCart);
        })
        .catch(function () { mrpCache[item.variant_id] = 0; })
        .then(function () { delete mrpPending[handle]; });
    });
  }

  /* The unit price for one cart line: what is being paid, then the MRP struck
     beside it. Mirrors snippets/cart-line-mrp.liquid exactly, class for class
     and in the same order, so a line looks identical whether it was
     server-rendered on load or rebuilt here after a quantity change. */
  function unitPrice(item) {
    var mrp = mrpFor(item);
    if (!(mrp > 0)) return money(item.final_price);
    return '<span class="price-group price-group--compact">' +
             '<span class="price-now" aria-hidden="true">' + money(item.final_price) + '</span>' +
             '<s class="price-was" aria-hidden="true">' + money(mrp) + '</s>' +
             '<span class="visually-hidden">' + money(item.final_price) +
               ', reduced from ' + money(mrp) + '</span>' +
           '</span>';
  }

  function renderDrawer(cart) {
    if (!drawer) return;
    var body = drawer.querySelector('[data-cart-body]');
    var foot = drawer.querySelector('[data-cart-foot]');
    if (!body) return;

    if (!cart.items.length) {
      body.innerHTML =
        '<div class="cart-empty">' +
          '<p class="cart-empty-title">Your cart is empty</p>' +
          '<p class="cart-empty-note">Free shipping and cash on delivery on every order.</p>' +
          '<a class="cta cart-empty-cta" href="' + esc(routes.root) + 'collections/all">Start shopping</a>' +
        '</div>';
      if (foot) foot.hidden = true;
      return;
    }
    if (foot) foot.hidden = false;

    body.innerHTML = cart.items.map(function (item) {
      var title = esc(item.product_title);
      var variant = item.variant_title && item.variant_title !== 'Default Title'
        ? '<p class="cart-line-variant">' + esc(item.variant_title) + '</p>' : '';
      return (
        '<div class="cart-line" data-line-key="' + esc(item.key) + '">' +
          '<div class="cart-line-img">' +
            (item.image
              ? '<img class="img-cover" src="' + esc(cdnImg(item.image, 144)) + '"' +
                ' srcset="' + esc(cdnImg(item.image, 72)) + ' 1x, ' + esc(cdnImg(item.image, 144)) + ' 2x"' +
                ' alt="" width="72" height="72" loading="lazy">'
              : '') +
          '</div>' +
          '<div>' +
            '<p class="cart-line-title">' + title + '</p>' + variant +
            '<p class="cart-line-price">' + unitPrice(item) + '</p>' +
            '<div class="cart-line-stepper stepper" data-qty-stepper>' +
              /* Every control is named with the product it belongs to. The old
                 markup gave every row the identical label "Quantity", so with
                 two items in the cart a screen reader announced three
                 indistinguishable "Quantity" controls. */
              '<button type="button" class="qty-btn" data-qty-minus aria-label="Decrease quantity of ' + title + '">−</button>' +
              '<input class="qty-input" type="number" inputmode="numeric" min="0" max="10" value="' + item.quantity + '"' +
                ' data-cart-qty-input data-line-key="' + esc(item.key) + '" aria-label="Quantity of ' + title + '">' +
              '<button type="button" class="qty-btn" data-qty-plus aria-label="Increase quantity of ' + title + '">+</button>' +
            '</div>' +
            '<button type="button" class="cart-line-remove" data-cart-remove data-line-key="' + esc(item.key) + '">' +
              'Remove<span class="visually-hidden"> ' + title + '</span></button>' +
          '</div>' +
          '<div class="cart-line-total">' + money(item.final_line_price) + '</div>' +
        '</div>'
      );
    }).join('');

    /* Everything the shopper had going when the rebuild landed has to survive
       it. innerHTML is the truth of the cart as Shopify last described it, and
       that is exactly why it cannot be the last word on two things:

       A removal still in flight. Remove two rows quickly and the first one's
       re-render replaces the second row's node, taking its pending dim with it
       and handing back a control that looks ready to be tapped again while its
       own request is still out.

       A quantity the shopper has tapped that is still held for sending.
       patchTotals is careful about this and renderDrawer was not, so a removal
       on one line — which always rebuilds — would silently revert an edit in
       progress on another. The edit still went out and still won on the server,
       so the number returned a moment later; the shopper watched their entry
       flip back and then flip forward again for no reason they could see.

       Both survive because both live in state that outlives the DOM. */
    Object.keys(removing).forEach(function (key) {
      var line = lineFor(key);
      if (line) { line.classList.add('is-removing'); line.setAttribute('aria-busy', 'true'); }
    });
    cart.items.forEach(function (item) {
      var held = qtyPending[item.key];
      if (!held) return;
      var line = lineFor(item.key);
      var input = line && line.querySelector('[data-cart-qty-input]');
      if (input) input.value = held.quantity;
    });
  }

  /* ---------------------------------------------------------------
     Cart transport — XMLHttpRequest, deliberately, not fetch.

     This is the fix for the bug that made the cart fail on the real
     storefront while every local test passed, and the reason is worth stating
     plainly because it is not obvious.

     A fetch Response body is a single-use stream. Whoever calls .json() or
     .text() on it first consumes it; every later reader gets "body stream
     already read", and even .clone() throws once the body has been disturbed.
     The theme is not alone on the page: this store runs Judge.me's cart drawer
     widget and two Microsoft Clarity embeds, and apps of that kind wrap
     window.fetch so they can notice cart mutations. An app embed loads in the
     document head, before this deferred script, so its wrapper is the fetch
     the theme ends up calling — and if it reads the response without cloning,
     it drains the body before the theme's own .json() ever runs. Every cart
     call then throws, and the drawer opens empty over a cart that is perfectly
     healthy on Shopify's side.

     That failure is invisible to any harness where the theme owns fetch
     outright, which is exactly what the previous suite did: its stub returned a
     hand-rolled object whose json() resolved a fresh value every time it was
     called. Infinitely re-readable, so the one thing that actually breaks in
     production could not be reproduced. Reproduced now, with real Response
     objects and a stand-in app embed: the drawer renders zero rows.

     XMLHttpRequest has no such hazard. responseText is a plain string that can
     be read any number of times, so an app that wraps XHR to watch cart traffic
     reads a copy by construction and cannot take the body away from us. The
     transport is the layer where this belongs — nothing above it has to know.

     Parsing is contained here too. A body that is not JSON — an HTML error
     page, a challenge page, a truncated response — yields data: null rather
     than throwing into a caller that would have to guess what happened. */
  var CART_GENERIC = 'Could not update your cart.';
  var CART_OFFLINE = 'Could not reach the cart. Check your connection.';

  function cartRequest(url, payload) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(payload ? 'POST' : 'GET', url, true);
      xhr.setRequestHeader('Accept', 'application/json');
      if (payload) xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.onload = function () {
        var data = null;
        try { data = JSON.parse(xhr.responseText); } catch (e) { data = null; }
        resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data: data });
      };
      xhr.onerror = function () { reject(new Error(CART_OFFLINE)); };
      xhr.ontimeout = function () { reject(new Error(CART_OFFLINE)); };
      xhr.send(payload ? JSON.stringify(payload) : null);
    });
  }

  /* Anything claiming to be a cart has to look like one before it is allowed
     near the DOM. A 200 carrying an error object, or a login page, must not be
     painted as an empty cart — that is how a shopper's basket appears to
     vanish. */
  function isCart(data) {
    return !!(data && data.items && typeof data.items.length === 'number'
              && typeof data.item_count === 'number');
  }

  /* Every paint is stamped with the revision it came from, and only the newest
     revision may paint. A read claims its revision when it is sent, so a
     mutation that lands while it is in flight supersedes it; a mutation claims
     its revision when its answer arrives, because at that instant it is the
     newest truth there is. One counter, checked in one place. */
  var cartRev = 0;
  function claim() { return ++cartRev; }

  function paintIfCurrent(cart, rev) {
    if (rev !== cartRev) return cart;
    applyCart(cart);
    return cart;
  }

  /* The authoritative read. Nothing else is allowed to be the source of truth
     for what the drawer shows. */
  function readCart() {
    var rev = claim();
    return cartRequest(routes.cart).then(function (res) {
      if (!res.ok || !isCart(res.data)) throw new Error(CART_OFFLINE);
      return { cart: res.data, rev: rev };
    });
  }

  function reconcile() {
    return readCart()
      .then(function (r) { return paintIfCurrent(r.cart, r.rev); })
      .catch(function () { /* Leave the last known-good paint standing. */ });
  }

  var cartLastFocus = null;

  function drawerFocusables() {
    return drawer.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'
    );
  }
  /* The mobile nav overlay had a focus trap; the cart drawer did not, so
     keyboard and screen-reader users tabbed straight out of an open drawer
     into the page behind it. */
  function onCartKey(e) {
    if (e.key === 'Escape') { closeDrawer(); return; }
    if (e.key !== 'Tab') return;
    var f = drawerFocusables();
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  }

  function openDrawer() {
    if (!drawer) return;
    cartLastFocus = document.activeElement;
    drawer.classList.add('on');
    drawer.setAttribute('aria-hidden', 'false');
    if (scrim) scrim.classList.add('on');
    document.body.classList.add('cart-open');

    /* The drawer slides in instantly but its contents do not exist until
       /cart.js resolves. Without a placeholder that gap reads as a stutter. */
    var body = drawer.querySelector('[data-cart-body]');
    if (body && !body.querySelector('.cart-line')) {
      body.innerHTML = '<div class="cart-skeleton" aria-hidden="true">' +
        '<div></div><div></div><div></div></div>';
    }
    drawer.setAttribute('aria-busy', 'true');
    showCartError('');
    /* Straight through the shared read. It claims a revision when it is sent, so
       a shopper who opens the drawer and immediately taps + has a GET and a POST
       in flight together and the GET — which describes the cart as it was before
       the tap — is discarded when it comes back second. Nothing here renders
       directly: paintIfCurrent inside reconcile is the only writer, which is what
       keeps this path and the mutation path from ever disagreeing. */
    readCart()
      .then(function (r) { paintIfCurrent(r.cart, r.rev); })
      .catch(function () {
        /* Only complain if there is nothing real on screen. If a previous read
           already painted the cart, leaving it up is better than replacing a
           correct drawer with an error. */
        if (body && !body.querySelector('.cart-line')) {
          body.innerHTML = '<div class="cart-empty"><p>Could not load your cart. Please refresh.</p></div>';
        }
      })
      .then(function () { drawer.removeAttribute('aria-busy'); });

    document.addEventListener('keydown', onCartKey);
    var close = drawer.querySelector('[data-cart-close]');
    if (close) close.focus();
  }

  function closeDrawer() {
    if (!drawer || !drawer.classList.contains('on')) return;
    /* Declared further down; both are function declarations in this same IIFE,
       so it is hoisted and this only ever runs on a real close. */
    flushQty();
    drawer.classList.remove('on');
    drawer.setAttribute('aria-hidden', 'true');
    if (scrim) scrim.classList.remove('on');
    document.body.classList.remove('cart-open');
    document.removeEventListener('keydown', onCartKey);
    if (cartLastFocus && document.contains(cartLastFocus)) cartLastFocus.focus();
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-cart-open]')) { e.preventDefault(); openDrawer(); }
    if (e.target.closest('[data-cart-close]')) { closeDrawer(); }
  });
  if (scrim) scrim.addEventListener('click', closeDrawer);

  /* The summary accordion. Display state and nothing else: it reads no cart and
     writes no cart, so it cannot participate in the class of bug the rest of
     this module is built to prevent.

     Its open/closed state survives every cart mutation for a structural reason
     rather than by being restored — renderDrawer rebuilds [data-cart-body] and
     the footer is not inside it, so a quantity change never touches this
     button or its panel. hidden is the whole mechanism, so a shopper who opens
     the breakdown and then changes a quantity watches the figures update
     underneath an accordion that stayed where they left it. */
  document.addEventListener('click', function (e) {
    var toggle = e.target.closest('[data-cart-summary-toggle]');
    if (!toggle) return;
    var panel = drawer && drawer.querySelector('[data-cart-summary-panel]');
    if (!panel) return;
    var open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
    panel.hidden = open;
  });

  /* Updates only the numbers, leaving the line markup where it is. A full
     re-render replaces the very input being tapped, which drops focus and
     discards anything typed since the request went out — so it is reserved
     for changes that actually alter the line-up. */
  function patchTotals(cart) {
    if (!drawer) return;
    cart.items.forEach(function (item) {
      var line = lineFor(item.key);
      if (!line) return;

      /* unitPrice, not money, and innerHTML, not textContent. These two paths
         have to agree: renderDrawer builds this element from unitPrice, which
         emits a struck original beside the current price whenever the shopper
         is paying under list. Writing textContent here flattened that to a
         single number, so a line that showed "₹1,299 ₹1,499 struck" on load
         silently lost the struck figure the first time anyone touched the
         stepper — the discount stopped being visible at the exact moment the
         shopper was changing how much of it they were getting. The only input
         is money() output, digits and a rupee sign, so there is nothing here
         to escape. */
      var unit = line.querySelector('.cart-line-price');
      if (unit) unit.innerHTML = unitPrice(item);
      var total = line.querySelector('.cart-line-total');
      if (total) total.textContent = money(item.final_line_price);

      /* One reason, and one only, to leave an input alone: it holds a number
         Shopify has not answered about yet. Everything else is written from the
         cart, because the cart is the authoritative state and the input has no
         business disagreeing with it.

         Focus deliberately does not appear in this test. Guarding on focus as
         well meant a quantity Shopify had just rejected stayed on screen for the
         one shopper most likely to be looking straight at it — type a number,
         press Enter, get "You can only add 9 of that to your cart", and watch
         the box go on saying 12 underneath the sentence explaining that it
         cannot. The cost is that a half-typed number can be corrected under the
         cursor by a paint belonging to another line; the benefit is that the
         drawer cannot display a quantity the cart does not hold. For a cart,
         that trade is not close. */
      var input = line.querySelector('[data-cart-qty-input]');
      if (input && !qtyPending[item.key]) input.value = item.quantity;
    });
  }

  function domKeys() {
    if (!drawer) return [];
    return [].map.call(drawer.querySelectorAll('.cart-line'), function (l) {
      return l.getAttribute('data-line-key');
    });
  }

  /* The Total Price summary, written from the same cart, on the same single
     path, as the subtotal it sits under.

     This puts a second set of figures on screen, which is the exact shape of
     problem this drawer has been bitten by before — so it is deliberately not a
     second source of them. writeSummary reads the cart it is handed and keeps
     no state of its own. There is nothing here to go stale because there is
     nothing here to remember, and it is called from one place, applyCart, so
     the single writer stays single.

       MRP Total     sum of each line's MRP times quantity — see mrpTotal
       MRP Discount  the gap between the two totals
       Cart Total    total_price, after every discount Shopify applied
       To Pay        total_price

     MRP Total is emphatically not cart.original_total_price. That field is the
     cart before Shopify's *discounts*, which for a mat listed at 1,900 and sold
     at 1,299 is 1,299 — it never sees the compare-at. Reading it put an MRP
     equal to the price and a saving of zero in front of a shopper looking at a
     601 reduction.

     The discount is the difference between the two authoritative totals rather
     than cart.total_discount read on its own. Two fields that are supposed to
     agree are two fields that can disagree; a difference cannot. Whatever
     Shopify took off, by whatever mechanism — the prepaid code sitting in the
     session, a line-level allocation, an automatic discount added next month —
     MRP Total minus MRP Discount is Cart Total by construction.

     The guard is a type check rather than a truthiness check on purpose: an
     empty cart totals zero, and zero is falsy. A mangled body should render
     nothing here; it should never render NaN. */
  function writeSummary(cart) {
    if (!drawer) return;

    var net = cart.total_price;
    if (typeof net !== 'number' || !cart.items) return;
    var gross = mrpTotal(cart);

    var saving = gross - net;

    var set = function (sel, text) {
      var el = drawer.querySelector(sel);
      if (el) el.textContent = text;
    };
    var show = function (sel, on) {
      var el = drawer.querySelector(sel);
      if (el) el.hidden = !on;
    };

    set('[data-cart-mrp]', money(gross));
    set('[data-cart-carttotal]', money(net));
    set('[data-cart-topay]', money(net));
    set('[data-cart-discount]', '−' + money(saving));
    set('[data-cart-save]', money(saving));

    /* A cart with nothing off it has no discount to explain. "MRP Discount ₹0"
       and "You Save ₹0" would both be true and both be useless, and they would
       put a zero in front of the shopper at the moment they are deciding
       whether the price is good. Both rows return the instant a discount does,
       because both are written on every paint rather than once on load. */
    show('[data-cart-discount-row]', saving > 0);
    show('[data-cart-save-row]', saving > 0);
  }

  /* The single writer. Every cart that reaches the DOM goes through here, and
     nothing else may touch the badge, the rows, the subtotal or the summary.

     Patch or rebuild is decided by comparing the line keys the DOM is showing
     against the line keys Shopify sent, in order. The previous version compared
     counts, which is the same thing only as long as nothing is ever swapped —
     one line removed and another added between two reads gives an identical
     count over a completely different cart, and the patch path would then
     update by key, find nothing, and silently leave the old rows on screen.
     Comparing the keys themselves makes that unrepresentable. */
  function applyCart(cart) {
    updateBadges(cart.item_count);
    if (!drawer) return;

    /* Held so a compare-at that arrives after this paint can be shown without
       re-reading the cart: ensureMrp calls applyCart again with this exact
       object. It is the cart Shopify last sent, never a cart built here. */
    lastCart = cart;
    ensureMrp(cart);

    var shown = domKeys();
    var wanted = cart.items.map(function (i) { return String(i.key); });
    var same = shown.length === wanted.length && shown.every(function (k, i) { return k === wanted[i]; });

    if (same && shown.length) patchTotals(cart);
    else renderDrawer(cart);

    /* The subtotal is written once, here, on every path — never inside a branch
       that a future edit could fail to reach. */
    var subtotal = drawer.querySelector('[data-cart-subtotal]');
    if (subtotal) subtotal.textContent = money(cart.total_price);

    /* Same rule, same reason: on every path, never inside a branch. */
    writeSummary(cart);

    var foot = drawer.querySelector('[data-cart-foot]');
    if (foot) foot.hidden = !cart.items.length;
  }

  /* Errors are shown, not just announced. The failure this exists for is
     "you can only add 2 of that", which a sighted shopper had no way to learn:
     it went to the visually-hidden live region and nowhere else. */
  function showCartError(msg) {
    var el = drawer && drawer.querySelector('[data-cart-error]');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  /* ---------------------------------------------------------------
     Cart mutations — one deterministic path

         USER INTENT -> queued request -> Shopify answer -> authoritative cart
                     -> single paint -> DOM

     Three rules hold the whole thing up, and every case below is an instance of
     them rather than a special case of its own:

     1. Mutations are serialised. One at a time, in the order the shopper made
        them, so Shopify is never asked to reconcile two versions of the truth
        and responses cannot land out of order.

     2. Nothing is painted from an unverified body. A mutation response is
        painted only if it actually parses as a cart; anything else — a 422, an
        HTML error page, a body some other script mangled — falls through to an
        authoritative re-read. isCart is what makes that decision, not a
        try/catch that hopes for the best.

     3. Every mutation ends in a paint of real Shopify state, on success and on
        failure alike. A failed edit re-reads the cart and paints that, so the
        shopper is always looking at what Shopify holds rather than at their own
        tap. There is no optimistic quantity anywhere to survive a failure,
        which is why there is nothing to roll back.

     The 422 shape is the one Shopify actually sends: status, message, and a
     description carrying the sentence a shopper needs ("You can only add 9 of
     that to your cart."). description only — message is the internal error
     class and is the literal string "Cart Error" on every cart failure there
     is, so surfacing it just replaces one unhelpful message with a
     worse-looking one. */
  var cartQueue = Promise.resolve();

  /* Lines with a removal in flight. Doubles as the guard against a second
     removal for the same line, whether it arrives from a tap, a repeated Enter,
     or the stepper being walked down to zero. */
  var removing = {};

  /* data-line-key values come from Shopify and contain colons; they are safe in
     an attribute selector but the quoting still has to be right. */
  function lineFor(key) {
    if (!drawer) return null;
    var k = String(key).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return drawer.querySelector('.cart-line[data-line-key="' + k + '"]');
  }

  function shopifyMessage(res) {
    if (res.data && res.data.description) return res.data.description;
    return CART_GENERIC;
  }

  /* The rebuild after a removal throws away the button that was just activated,
     so a keyboard shopper would land on document.body — outside an aria-modal
     dialog, with the next Tab going to the page behind it. Only when focus was
     in the drawer to begin with: a removal driven by a pointer must not steal
     it. */
  function keepFocusInDrawer(had) {
    if (!had || !drawer) return;
    var a = document.activeElement;
    if (a && a !== document.body && drawer.contains(a)) return;
    var next = drawer.querySelector('[data-cart-remove]')
            || drawer.querySelector('[data-cart-close]')
            || drawer.querySelector('a[href],button:not([disabled])');
    if (next) next.focus();
  }

  /* Drops the removal claim and takes the pending dim off the live row.

     Both halves matter, and the order they run in relative to the paint is the
     whole subtlety. Clearing only the map leaves the class on screen, because
     the paint that follows re-applies it from the map it was just removed from —
     or, if the cart re-read fails too, never runs at all and cannot clean
     anything. A row stuck at half opacity with pointer-events:none is worse
     than the failure that caused it: the shopper cannot retry, cannot change
     the quantity, and has no way to tell the row is not simply broken. */
  function clearRemoval(key) {
    delete removing[key];
    var line = lineFor(key);
    if (line) { line.classList.remove('is-removing'); line.removeAttribute('aria-busy'); }
  }

  /* Shopify has answered about this line, so the shopper's unconfirmed number
     for it stops being newer than the cart and the paint that follows must be
     free to overwrite the input.

     Releasing it here rather than when the promise finally settles is what makes
     a rejection visible. A quantity Shopify refused is not a pending intent, it
     is a wrong number on screen: with the claim still standing, the reconcile
     painted every other field and skipped the one box the shopper was looking
     at, so an inventory rejection left "3" in the input over a cart holding 2,
     with the error message directly underneath explaining why it could not be
     3. Only the entry this request actually carried is released — a tap that
     arrived during the round trip is a newer intent and keeps its protection. */
  function settleIntent(key, quantity) {
    var p = qtyPending[key];
    if (p && p.sent && p.quantity === quantity) delete qtyPending[key];
  }

  function changeLine(key, quantity, label) {
    if (quantity === 0) removing[key] = true;

    cartQueue = cartQueue.then(function () {
      var hadFocus = !!(drawer && document.activeElement && drawer.contains(document.activeElement));

      return cartRequest(routes.cartChange, { id: key, quantity: quantity })
        .then(function (res) {
          settleIntent(key, quantity);
          if (!res.ok) throw new Error(shopifyMessage(res));
          showCartError('');
          if (quantity === 0) announce((label ? label + ' removed' : 'Item removed') + ' from cart.');
          else if (isCart(res.data)) announce('Cart updated. Subtotal ' + money(res.data.total_price) + '.');
          else announce('Cart updated.');

          /* Rule 2. A mutation that came back with a real cart is the newest
             truth and is painted directly; anything else is not trusted and the
             reconcile below fetches the truth instead. */
          if (isCart(res.data)) { paintIfCurrent(res.data, claim()); return; }
          return reconcile();
        })
        .catch(function (err) {
          /* Also here: a request that never reached Shopify at all leaves the
             same wrong number on screen as one Shopify refused. */
          settleIntent(key, quantity);
          showCartError(err.message);
          announce(err.message);
          /* Before the paint, not after. The row is staying, so the shopper must
             get back a row they can use — and this has to happen even if the
             re-read below fails as well and no paint ever comes. */
          if (quantity === 0) clearRemoval(key);
          /* Rule 3. Whatever went wrong, the drawer must end up on Shopify's
             actual cart. */
          return reconcile();
        })
        .then(function () {
          /* On the success path the claim is still held here, which is
             deliberate: it spans the whole round trip plus the paint, so a
             second Enter on a Remove button that is still on screen cannot send
             a second removal for a line Shopify has already dropped. By now the
             row is gone, so this is a map delete and nothing more.

             Only for a removal. Unconditionally, this released a claim it had
             not made: a quantity change that settled while a removal for the
             same line was still queued would drop that removal's guard, and the
             next tap on Remove would queue the line a second time. */
          if (quantity === 0) clearRemoval(key);
          keepFocusInDrawer(hadFocus);
        });
    });
    return cartQueue;
  }

  /* A run of stepper taps is one decision, not four. Serialising alone kept the
     calls in order but the shopper still paid a round trip per tap to say "5",
     and each answer repainted the drawer under their finger. The request is held
     until the taps stop and one goes out carrying the final number.

     qtyPending holds the number the shopper wants for a line that Shopify has
     not confirmed yet, and it holds it for the whole of that time — through the
     wait, through the request, until the answer lands. That span is deliberate,
     and it is the reason a paint can be as blunt as "write every input from the
     cart": the one case where the cart is not the newest truth for a field is
     precisely the case this map describes.

     An earlier version deleted the entry the moment the request went out, which
     left the input unguarded for the entire round trip. Change line A, change
     line B, and the paint belonging to A — which predates B's tap and still
     carries B's old quantity — would land while B was in flight and write that
     stale number back into B's box. The shopper watched their own entry revert
     and then, a moment later, correct itself. One map covering one idea, rather
     than two maps covering two halves of it, is what makes that unreachable. */
  var QTY_DELAY = 350;
  var qtyPending = {};

  function sendQty(key) {
    var p = qtyPending[key];
    if (!p || p.sent) return;
    window.clearTimeout(p.timer);
    p.sent = true;
    /* The entry is released inside changeLine, the instant Shopify answers and
       before anything repaints — see settleIntent. */
    changeLine(key, p.quantity);
  }

  function queueQtyChange(key, quantity) {
    var p = qtyPending[key];
    if (p && !p.sent) window.clearTimeout(p.timer);
    qtyPending[key] = {
      quantity: quantity,
      sent: false,
      timer: window.setTimeout(function () { sendQty(key); }, QTY_DELAY)
    };
  }

  /* Anything that ends the shopper's time with the drawer has to send the held
     edit first, or their last tap dies with the timer. pointerdown rather than
     click, so the request is already in flight while the tap completes. This
     narrows the window rather than closing it: if navigation still beats the
     response, the cart keeps its previous quantity — stale, never corrupt. */
  function flushQty() { Object.keys(qtyPending).forEach(sendQty); }

  if (drawer) {
    drawer.addEventListener('pointerdown', function (e) {
      /* Every way out of the footer. Only links leave it today, but the
         selector covers buttons too: a control that navigates and does not
         flush the held edit sends the shopper to checkout with the quantity
         they had before their last tap, and that failure is silent. */
      if (e.target.closest('[data-cart-foot] a, [data-cart-foot] button')) flushQty();
    });
    drawer.addEventListener('click', function (e) {
      var rm = e.target.closest('[data-cart-remove]');
      if (!rm) return;
      var key = rm.dataset.lineKey;
      /* pointer-events:none on the dimmed row stops the second tap, but not a
         second Enter from a keyboard user whose focus is still on the button.
         The guard is the state, not the styling. */
      if (removing[key]) return;

      var line = rm.closest('.cart-line');
      var t = line && line.querySelector('.cart-line-title');
      /* Removals go straight out: the line-up changes either way, so there is
         nothing for a debounce to coalesce. */
      delete qtyPending[key];

      /* Asked, not done. The row dims and stops taking input so the tap is
         acknowledged, and that is all it does — it keeps its height and its
         place, and everything below it stays put. Nothing here asserts an
         outcome, so there is nothing to undo if Shopify refuses: the paint that
         ends every mutation rebuilds or patches from the real cart, and this
         class cannot survive either. The row leaves when, and only when,
         Shopify's cart no longer contains it. */
      if (line) {
        line.classList.add('is-removing');
        line.setAttribute('aria-busy', 'true');
      }
      changeLine(key, 0, t ? t.textContent : '');
    });
    drawer.addEventListener('change', function (e) {
      var input = e.target.closest('[data-cart-qty-input]');
      if (input) { queueQtyChange(input.dataset.lineKey, parseInt(input.value, 10) || 0); }
    });
    window.addEventListener('pagehide', flushQty);
  }

  /* ---------------------------------------------------------------
     Buy box: AJAX add-to-cart + prepaid discount redirect
  --------------------------------------------------------------- */
  /* Pending state is one attribute. The old version hunted for
     [data-btn-label] and [data-btn-spinner], which no template in the theme has
     ever rendered — so every add-to-cart, on the PDP and in the grid alike, ran
     its whole round trip with no feedback beyond a disabled attribute. It was
     also a latent bug: restoring the label by writing back textContent would
     have flattened the visually-hidden product name inside the card's button
     into visible text. aria-busy tells assistive tech directly, and CSS does
     the label swap without the DOM being rewritten. */
  document.addEventListener('submit', function (e) {
    var form = e.target.closest('[data-buybox-form]');
    if (!form) return;
    e.preventDefault();

    var btn = form.querySelector('[data-add-to-cart]');
    var errorEl = form.querySelector('[data-buybox-error]');

    if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
    if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }

    /* Same transport as every other cart call. This handler used to read the
       response body with fetch's single-use .json(), which is the exact thing an
       app embed on the page can consume first — an add that had actually
       succeeded would then report an error to the shopper. */
    cartRequest(routes.cartAdd, {
      id: form.querySelector('[name="id"]').value,
      quantity: parseInt(form.querySelector('[name="quantity"]').value, 10) || 1
    })
      .then(function (res) {
        if (!res.ok) throw new Error((res.data && res.data.description) || 'Could not add to cart');
        /* The add response describes the line added, not the whole cart, so the
           cart is read rather than inferred. */
        return readCart();
      })
      .then(function (r) {
        paintIfCurrent(r.cart, r.rev);
        openDrawer();
        announce('Added to cart. ' + r.cart.item_count +
                 (r.cart.item_count === 1 ? ' item' : ' items') +
                 ', subtotal ' + money(r.cart.total_price) + '.');
      })
      .catch(function (err) {
        if (errorEl) { errorEl.hidden = false; errorEl.textContent = err.message; }
        announce(err.message);
      })
      .then(function () {
        if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
      });
  });

  /* ---------------------------------------------------------------
     Offer code: copy to clipboard, and nothing else

     What used to live here navigated to /discount/CODE, which wrote the code
     onto the shopper's cart for the rest of the session with no way back off.
     It is gone rather than disabled: dead code that still knows how to reach
     that endpoint is one careless re-render away from being reachable again,
     and the requirement is that no path to it exists.

     This handler reads a string off the button and puts it on the clipboard.
     It sends no request, changes no URL, and touches nothing the cart owns —
     the price stays the price on the product until the shopper chooses to type
     the code at checkout.

     preventDefault because this button renders inside the product form. It is
     already type="button", so it should not submit; the call costs nothing and
     removes the possibility that a markup edit turns Copy into Add to Cart. */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-offer-copy]');
    if (!btn) return;
    e.preventDefault();

    var code = btn.getAttribute('data-offer-value');
    if (!code) return;

    var wrap = btn.closest('.offer');
    var status = wrap && wrap.querySelector('[data-offer-status]');

    /* The label swap is a class, not textContent. Both words ship in the
       markup and CSS shows one, so the accessible name inside the button
       survives — the same reason the add-to-cart buttons stopped rewriting
       themselves. */
    var confirm = function (msg) {
      btn.classList.add('is-copied');
      /* A tap's worth of haptic on success only — never on the fallback, where
         nothing has actually reached the clipboard yet. Feature-detected and
         wrapped, because some browsers expose vibrate and then throw on it,
         and a copy that worked must not report failure because a motor did
         not spin. Nothing here is required for the copy to succeed. */
      if (navigator.vibrate) { try { navigator.vibrate(10); } catch (e) {} }
      if (status) status.textContent = msg;
      clearTimeout(btn._offerT);
      btn._offerT = setTimeout(function () {
        btn.classList.remove('is-copied');
        if (status) status.textContent = '';
      }, 2000);
    };

    /* Selecting the code is the fallback, not a consolation. Clipboard access
       is refused on insecure origins and in some in-app browsers, and a button
       that silently does nothing there is worse than no button: the shopper is
       left holding a code they were told they could copy. Selecting it puts
       the text under the platform's own copy affordance, which is the thing
       they would have reached for anyway. */
    var selectCode = function () {
      var el = wrap && wrap.querySelector('[data-offer-code]');
      if (!el || !window.getSelection || !document.createRange) return;
      var range = document.createRange();
      range.selectNodeContents(el);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(function () {
        confirm(code + ' copied to the clipboard.');
      }).catch(function () {
        selectCode();
        confirm(code + ' selected. Copy it with your browser.');
      });
      return;
    }
    selectCode();
    confirm(code + ' selected. Copy it with your browser.');
  });


  /* ---------------------------------------------------------------
     Product videos: exactly one plays, and it is the one being looked at

     Muted autoplay, driven from here rather than from an autoplay attribute.
     The attribute would start every clip in the strip on load, whether or not
     the shopper ever reaches this section — the bytes and the battery spent
     before anyone has scrolled, and several clips running at once the moment
     they do. This starts one.

     "Most visible" is the whole rule. The strip deliberately shows a second
     clip at around 80%, so two of them clear any single visibility threshold
     at the same time; picking the highest ratio each time the observer fires
     is what keeps that from becoming two videos playing side by side. The
     rest are paused, including the one that was playing a moment ago, so
     nothing is ever running off screen.

     Reduced motion takes the autoplay away and leaves the buttons: nothing
     starts by itself, but a clip the shopper started is still stopped when it
     leaves, because unexpected audio from off screen is not motion.

     play() returns a promise that rejects when the browser declines — a data
     saver, a battery mode, a policy this page cannot see. That is a normal
     outcome, not an error. There is exactly one retry, and only for the one
     cause this code can actually fix: sound. An unmuted play() is the request
     a browser is most likely to refuse, so a rejection with sound on drops
     back to muted and tries once more. A rejection while already muted is
     final — the poster and the play button are the fallback, and hammering
     play() at a browser that has said no is how a page burns a battery.

     Every visible state is read back off the media element's own play, pause
     and volumechange events rather than set alongside the call that caused
     it. A browser that pauses a clip on its own — a phone call, a background
     tab, an OS media key — moves the button with it. */
  (function productVideos() {
    var frames = [].slice.call(document.querySelectorAll('[data-pvid-frame]'));
    if (!frames.length) return;

    var list    = frames.map(function (f) { return f.querySelector('video'); });
    var toggles = frames.map(function (f) { return f.querySelector('[data-pvid-toggle]'); });
    var sounds  = frames.map(function (f) { return f.querySelector('[data-pvid-sound]'); });
    var ratio   = frames.map(function () { return 0; });

    /* A clip the shopper pressed pause on. The observer fires again on the
       next scroll pixel, so without this the strip would restart the one
       thing they just stopped. Cleared when the clip leaves the viewport, so
       the hold lasts as long as they are looking at it and no longer. */
    var held = frames.map(function () { return false; });

    /* Sound belongs to the strip, not to a clip: one clip plays at a time, so
       a per-clip setting would mean turning it on again at every swipe. */
    var soundOn = false;

    function play(v) {
      var p = v.play();
      if (!p || !p.catch) return;
      p.catch(function () {
        if (v.muted) return;
        v.muted = true;
        soundOn = false;
        syncSound();
        var q = v.play();
        if (q && q.catch) q.catch(function () {});
      });
    }

    function syncPlay(i) {
      var playing = !list[i].paused;
      var label = frames[i].getAttribute('data-pvid-label') || 'video';
      if (playing) frames[i].setAttribute('data-playing', '');
      else frames[i].removeAttribute('data-playing');
      toggles[i].setAttribute('aria-label', (playing ? 'Pause ' : 'Play ') + label);
    }

    function syncSound() {
      frames.forEach(function (f, i) {
        if (soundOn) f.setAttribute('data-sound', '');
        else f.removeAttribute('data-sound');
        sounds[i].setAttribute('aria-label', soundOn ? 'Turn sound off' : 'Turn sound on');
      });
    }

    toggles.forEach(function (btn, i) {
      btn.addEventListener('click', function () {
        var v = list[i];
        if (v.paused) {
          held[i] = false;
          v.muted = !soundOn;
          play(v);
        } else {
          held[i] = true;
          v.pause();
        }
      });
    });

    sounds.forEach(function (btn, i) {
      btn.addEventListener('click', function () {
        soundOn = !soundOn;
        list.forEach(function (o, j) { if (j !== i) o.muted = true; });
        list[i].muted = !soundOn;
        syncSound();
        /* Turning sound on is a gesture, and a gesture is what a browser
           wants before it will allow audible playback — so it is also the
           right moment to start a clip that autoplay never got to start. */
        if (soundOn && list[i].paused) {
          held[i] = false;
          play(list[i]);
        }
      });
    });

    list.forEach(function (v, i) {
      ['play', 'pause', 'volumechange'].forEach(function (e) {
        v.addEventListener(e, function () { syncPlay(i); });
      });
      syncPlay(i);
    });
    syncSound();

    /* The buttons above work without an observer. Only the autoplay does not,
       so a browser without IntersectionObserver gets a strip of posters with
       play buttons, which is the same fallback a blocked autoplay gets. */
    if (!window.IntersectionObserver) return;

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var i = list.indexOf(e.target);
        if (i > -1) {
          ratio[i] = e.intersectionRatio;
          if (e.intersectionRatio < 0.05) held[i] = false;
        }
      });

      if (RM) {
        /* Never started here, but still stopped on the way out. */
        list.forEach(function (v, i) { if (ratio[i] < 0.25 && !v.paused) v.pause(); });
        return;
      }

      var best = -1, bestRatio = 0.6;
      ratio.forEach(function (r, i) { if (r > bestRatio) { bestRatio = r; best = i; } });

      list.forEach(function (v, i) {
        if (i === best && !held[i]) {
          if (v.paused) {
            v.muted = !soundOn;
            play(v);
          }
        } else if (!v.paused) {
          v.pause();
          v.muted = true;
        }
      });
    }, { threshold: [0, 0.05, 0.25, 0.5, 0.6, 0.75, 1] });

    list.forEach(function (v) { io.observe(v); });
  })();

})();
