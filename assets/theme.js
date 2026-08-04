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
    var anchor = document.querySelector('[data-buybar-anchor]');
    if (!bar || !anchor) return;

    var hideEl = document.querySelector('[data-buybar-hide]');
    var pastAnchor = false, atHide = false;

    function paint() { bar.classList.toggle('on', pastAnchor && !atHide); }

    new IntersectionObserver(function (entries) {
      pastAnchor = !entries[0].isIntersecting;
      paint();
    }, { threshold: 0 }).observe(anchor);

    if (hideEl) {
      new IntersectionObserver(function (entries) {
        atHide = entries[0].isIntersecting;
        paint();
      }, { threshold: 0.25 }).observe(hideEl);
    }
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
          thumbs.forEach(function (t, idx) { t.classList.toggle('is-active', idx === i); });
          dots.forEach(function (d, idx) { d.classList.toggle('is-active', idx === i); });
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
    var min = parseInt(input.min, 10) || 1;
    var max = parseInt(input.max, 10) || 99;
    var val = parseInt(input.value, 10) || min;
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
            (item.image ? '<img class="img-cover" src="' + esc(item.image) + '" alt="" width="72" height="72" loading="lazy">' : '') +
          '</div>' +
          '<div>' +
            '<p class="cart-line-title">' + title + '</p>' + variant +
            '<p class="cart-line-price">' + money(item.final_price) + '</p>' +
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

  /* Quantity edits were fired one request per click with no sequencing, so
     tapping + three times raced three /cart/change calls and whichever
     response landed last won — which is not necessarily the last click.
     Requests are now queued so the final state always reflects the final tap. */
  var cartQueue = Promise.resolve();
  function changeLine(key, quantity, label) {
    cartQueue = cartQueue.then(function () {
      return fetch(routes.cartChange, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id: key, quantity: quantity })
      })
        .then(function (r) { return r.json(); })
        .then(function (cart) {
          updateBadges(cart.item_count);
          renderDrawer(cart);
          if (quantity === 0) announce((label ? label + ' removed' : 'Item removed') + ' from cart.');
          else announce('Cart updated. Subtotal ' + money(cart.total_price) + '.');
          return cart;
        })
        .catch(function () { announce('Could not update your cart. Please try again.'); });
    });
    return cartQueue;
  }

  if (drawer) {
    drawer.addEventListener('click', function (e) {
      var rm = e.target.closest('[data-cart-remove]');
      if (rm) {
        var line = rm.closest('.cart-line');
        var t = line && line.querySelector('.cart-line-title');
        changeLine(rm.dataset.lineKey, 0, t ? t.textContent : '');
      }
    });
    drawer.addEventListener('change', function (e) {
      var input = e.target.closest('[data-cart-qty-input]');
      if (input) { changeLine(input.dataset.lineKey, parseInt(input.value, 10) || 0); }
    });
  }

  /* ---------------------------------------------------------------
     Buy box: AJAX add-to-cart + prepaid discount redirect
  --------------------------------------------------------------- */
  document.addEventListener('submit', function (e) {
    var form = e.target.closest('[data-buybox-form]');
    if (!form) return;
    e.preventDefault();

    var btn = form.querySelector('[data-add-to-cart]');
    var label = form.querySelector('[data-btn-label]');
    var spinner = form.querySelector('[data-btn-spinner]');
    var errorEl = form.querySelector('[data-buybox-error]');
    var originalLabel = label ? label.textContent : '';

    if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
    if (btn) btn.disabled = true;
    if (spinner) spinner.hidden = false;
    if (label) label.style.visibility = 'hidden';

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
        if (btn) btn.disabled = false;
        if (spinner) spinner.hidden = true;
        if (label) { label.style.visibility = ''; label.textContent = originalLabel; }
      });
  });

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-buy-prepaid]');
    if (!btn) return;
    var form = btn.closest('[data-buybox-form]');
    var code = btn.dataset.discountCode;
    if (!form || !code) return;
    btn.disabled = true;
    var originalText = btn.textContent;
    btn.textContent = 'Redirecting…';

    fetch(routes.cartAdd, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        id: form.querySelector('[name="id"]').value,
        quantity: parseInt(form.querySelector('[name="quantity"]').value, 10) || 1
      })
    }).then(function () {
      window.location.href = routes.root + 'discount/' + encodeURIComponent(code) + '?redirect=/checkout';
    }).catch(function () {
      btn.disabled = false;
      btn.textContent = originalText;
    });
  });

})();
