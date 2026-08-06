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
      b.textContent = count;
      b.hidden = count === 0;
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

  /* The unit price for one cart line, struck original first where the shopper
     is paying less than list. Mirrors the Liquid in sections/cart-drawer.liquid
     exactly, including the class names, so a line looks identical whether it
     was server-rendered on load or rebuilt here after a quantity change.

     original_price, not the variant's compare_at_price: /cart.js carries no
     compare-at field, so this path could not read one, and a struck figure that
     showed on load and disappeared on the first AJAX update would be worse than
     not showing it at all. */
  function unitPrice(item) {
    if (!(item.original_price > item.final_price)) return money(item.final_price);
    return '<span class="price-group price-group--compact">' +
             '<s class="price-was" aria-hidden="true">' + money(item.original_price) + '</s>' +
             '<span class="visually-hidden">Was ' + money(item.original_price) +
               ', now ' + money(item.final_price) + '</span>' +
             '<span class="price-now" aria-hidden="true">' + money(item.final_price) + '</span>' +
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

    var subtotal = drawer.querySelector('[data-cart-subtotal]');
    if (subtotal) subtotal.textContent = money(cart.total_price);
  }

  function fetchCart() {
    return fetch(routes.cart).then(function (r) { return r.json(); });
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
    fetchCart()
      .then(function (cart) { renderDrawer(cart); updateBadges(cart.item_count); })
      .catch(function () {
        if (body) body.innerHTML = '<div class="cart-empty"><p>Could not load your cart. Please refresh.</p></div>';
      })
      .finally(function () { drawer.removeAttribute('aria-busy'); });

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

  /* Updates only the numbers, leaving the line markup where it is. A full
     re-render replaces the very input being tapped, which drops focus and
     discards anything typed since the request went out — so it is reserved
     for changes that actually alter the line-up. */
  function patchTotals(cart) {
    if (!drawer) return;
    var subtotal = drawer.querySelector('[data-cart-subtotal]');
    if (subtotal) subtotal.textContent = money(cart.total_price);

    cart.items.forEach(function (item) {
      var key = String(item.key).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      var line = drawer.querySelector('.cart-line[data-line-key="' + key + '"]');
      if (!line) return;

      var unit = line.querySelector('.cart-line-price');
      if (unit) unit.textContent = money(item.final_price);
      var total = line.querySelector('.cart-line-total');
      if (total) total.textContent = money(item.final_line_price);

      /* Never overwrite a field the shopper is still working in, or one with
         an edit already queued behind this response — their number is newer
         than the cart we are holding. */
      var input = line.querySelector('[data-cart-qty-input]');
      if (input && document.activeElement !== input && !qtyPending[item.key]) {
        input.value = item.quantity;
      }
    });
  }

  /* One place decides how a cart response reaches the drawer: patch the
     numbers where the line-up is unchanged, re-render where it is not. Both
     the success path and the recovery path below need exactly this, and having
     them share it is what keeps the two from drifting apart. */
  function applyCart(cart) {
    updateBadges(cart.item_count);
    var shown = drawer ? drawer.querySelectorAll('.cart-line').length : 0;
    if (shown && shown === cart.items.length) patchTotals(cart);
    else renderDrawer(cart);
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

  /* Quantity edits were fired one request per click with no sequencing, so
     tapping + three times raced three /cart/change calls and whichever
     response landed last won — which is not necessarily the last click.
     Requests are queued so the final state always reflects the final tap.

     The response is checked before it is believed. /cart/change.js answers a
     rejected quantity with 422 and a Cart Error object, not a cart — and this
     used to pipe r.json() straight into the success path. updateBadges then
     read item_count off an error, blanking the header count, and the next line
     threw on cart.items, so the catch swallowed it and every price in the
     drawer kept the value it had while the input kept the number the shopper
     had tapped. Stock ran out and the drawer quietly lied until a refresh.
     Same shape as the add-to-cart handler, which has always checked r.ok. */
  var CART_GENERIC = 'Could not update your cart.';
  var cartQueue = Promise.resolve();
  function changeLine(key, quantity, label) {
    cartQueue = cartQueue.then(function () {
      return fetch(routes.cartChange, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id: key, quantity: quantity })
      })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
        .then(function (res) {
          /* description only. `message` is Shopify's internal error class and
             is the literal string "Cart Error" on every cart failure there is —
             surfacing it just replaces one unhelpful message with a
             worse-looking one. */
          if (!res.ok) throw new Error(res.data.description || CART_GENERIC);
          var cart = res.data;
          showCartError('');
          applyCart(cart);
          if (quantity === 0) announce((label ? label + ' removed' : 'Item removed') + ' from cart.');
          else announce('Cart updated. Subtotal ' + money(cart.total_price) + '.');
          return cart;
        })
        .catch(function (err) {
          showCartError(err.message);
          announce(err.message);
          /* Whatever went wrong, the drawer is now showing a quantity the cart
             may not hold. Re-read the real cart and put the drawer back on it,
             through the same path a successful change takes — a failed edit
             should leave the shopper looking at the truth, not at their own
             optimistic tap. */
          return fetchCart().then(applyCart).catch(function () {});
        });
    });
    return cartQueue;
  }

  /* A run of stepper taps is one decision, not four. Queueing kept the calls
     in order but the shopper still paid a round-trip per tap to say "5", and
     each response re-rendered the drawer under their finger. The request is
     now held until the taps stop and one goes out carrying the final number. */
  var QTY_DELAY = 350;
  var qtyPending = {};

  function sendQty(key) {
    var p = qtyPending[key];
    if (!p) return;
    window.clearTimeout(p.timer);
    delete qtyPending[key];
    changeLine(key, p.quantity);
  }

  function queueQtyChange(key, quantity) {
    if (qtyPending[key]) window.clearTimeout(qtyPending[key].timer);
    qtyPending[key] = {
      quantity: quantity,
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
      /* Every way out of the footer, not just the links: the prepaid button is
         a <button> and navigates the same as Checkout does. */
      if (e.target.closest('[data-cart-foot] a, [data-cart-foot] button')) flushQty();
    });
    drawer.addEventListener('click', function (e) {
      var rm = e.target.closest('[data-cart-remove]');
      if (rm) {
        var line = rm.closest('.cart-line');
        var t = line && line.querySelector('.cart-line-title');
        /* Removals go straight out: the line-up changes either way, so there
           is nothing for a debounce to coalesce. */
        delete qtyPending[rm.dataset.lineKey];
        changeLine(rm.dataset.lineKey, 0, t ? t.textContent : '');
      }
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

    fetch(routes.cartAdd, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        id: form.querySelector('[name="id"]').value,
        quantity: parseInt(form.querySelector('[name="quantity"]').value, 10) || 1
      })
    })
      .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.data.description || 'Could not add to cart');
        return fetchCart();
      })
      .then(function (cart) {
        updateBadges(cart.item_count);
        renderDrawer(cart);
        openDrawer();
        announce('Added to cart. ' + cart.item_count +
                 (cart.item_count === 1 ? ' item' : ' items') +
                 ', subtotal ' + money(cart.total_price) + '.');
      })
      .catch(function (err) {
        if (errorEl) { errorEl.hidden = false; errorEl.textContent = err.message; }
        announce(err.message);
      })
      .finally(function () {
        if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
      });
  });

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-buy-prepaid]');
    if (!btn) return;
    var code = btn.dataset.discountCode;
    if (!code) return;

    /* Two callers now. In the buy box the button sits inside a product form and
       has to add the item before it can send anyone to checkout. In the cart
       drawer the goods are already in the cart, so adding again would silently
       double the order — there, the button only applies the code. */
    var form = btn.closest('[data-buybox-form]');

    btn.disabled = true;
    var originalText = btn.textContent;
    btn.textContent = 'Redirecting…';

    var go = function () {
      window.location.href = routes.root + 'discount/' + encodeURIComponent(code) + '?redirect=/checkout';
    };
    var recover = function () {
      btn.disabled = false;
      btn.textContent = originalText;
    };

    if (!form) { go(); return; }

    fetch(routes.cartAdd, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        id: form.querySelector('[name="id"]').value,
        quantity: parseInt(form.querySelector('[name="quantity"]').value, 10) || 1
      })
    }).then(go).catch(recover);
  });

})();
