/* ---------------------------------------------------------------------------
   mj-features.js — new features under test.

   Everything here is additive and self-contained. Nothing in this file edits
   assets/theme.js, which is 96KB and cannot be safely rewritten through
   themeFilesUpsert in one push. Each feature below hooks the existing markup
   from the outside, by attribute, the same way theme.js's own delegated
   handlers do.

   Load order matters for exactly one of these (the cart fix, which listens in
   the capture phase), so this file is loaded before theme.js in theme.liquid.

   Remove the two tags from layout/theme.liquid and every behaviour here is
   gone, with no other file to unwind.
   --------------------------------------------------------------------------- */
(function () {
  'use strict';

  var RM = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* =========================================================================
     1. Cart drawer: restore quantity controls on a returning visit

     sections/cart-drawer.liquid server-renders each line as a static
     "Qty N" with no stepper and no Remove. theme.js renders the same lines
     with both. Which one a shopper gets is decided in applyCart():

         var same = shown.length === wanted.length && shown.every(...)
         if (same && shown.length) patchTotals(cart); else renderDrawer(cart);

     Open the drawer on a fresh page load with something already in the cart
     and the server-rendered keys match Shopify's exactly, so patchTotals()
     runs, renderDrawer() never does, and the shopper is left with markup that
     has nothing to click. The cart cannot be edited at all until something
     changes the line set.

     The fix is to make the diff fail on that first open. If the body holds
     lines that carry no quantity input, they are the server-rendered kind and
     are cleared, so theme.js sees an empty body, paints its skeleton and
     builds the interactive version.

     Capture phase, so this runs before theme.js's own click handler on the
     same event rather than after it.

     The cleaner fix is to render the stepper in cart-drawer.liquid so both
     paths emit the same shape and the cart works with JS disabled. That is a
     15KB file rewrite; this is six lines and is reversible. Prefer the Liquid
     fix when promoting to the live theme.
     ========================================================================= */
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest || !t.closest('[data-cart-open]')) return;
    var body = document.querySelector('[data-cart-body]');
    if (!body) return;
    if (body.querySelector('.cart-line') && !body.querySelector('[data-cart-qty-input]')) {
      body.innerHTML = '';
    }
  }, true);

  /* =========================================================================
     2. Pincode: check automatically on the sixth digit

     The Check button stays. It is the only affordance a screen-reader user
     has that an action is available, and it is still the way to re-run a
     check without editing the field.

     Guarded on the last value actually checked rather than on length alone,
     so arrowing around inside a complete pincode does not re-fire, while
     deleting a digit and typing a different one does.
     ========================================================================= */
  (function pincodeAuto() {
    var wrap = document.querySelector('[data-pincode]');
    if (!wrap) return;
    var input = wrap.querySelector('[data-pincode-input]');
    var button = wrap.querySelector('[data-pincode-submit]');
    if (!input || !button) return;

    var lastChecked = '';
    var timer = null;

    input.addEventListener('input', function () {
      var v = (input.value || '').replace(/\D/g, '');
      if (v !== input.value) input.value = v;

      if (v.length < 6) {
        lastChecked = '';
        return;
      }
      if (v === lastChecked) return;

      clearTimeout(timer);
      timer = setTimeout(function () {
        if ((input.value || '').replace(/\D/g, '') !== v) return;
        lastChecked = v;
        button.click();
      }, 120);
    });
  })();

  /* =========================================================================
     3. Urgency line: per-product copy with a daily figure

     Only the two new products carry a figure. Both play mats are untouched
     and keep the line buy-box.liquid already renders.

     The number is derived from the UTC date, so every visitor sees the same
     value on the same day and a refresh does not re-roll it. Computed here
     rather than in Liquid because Liquid output is cached by Shopify's CDN
     and would freeze on whatever day the cache was written.

     Salts differ per product so the two do not move in step.
     ========================================================================= */
  var URGENCY = {
    'mamajoy-baby-carrier-for-babies-0-3-years-ergonomic-safe-navy-blue': {
      text: 'Best seller &middot; {n} dispatched today',
      min: 80, max: 100, salt: 3
    },
    'mamajoy-baby-feeding-pillow-for-new-born-baby-nursing-pillow-for-breastfeeding': {
      text: 'Selling fast &middot; {n} dispatched today',
      min: 35, max: 55, salt: 4
    }
  };

  function seededDaily(min, max, salt) {
    var d = new Date();
    var seed = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    var h = (seed * 2654435761 + salt * 40503) % 2147483647;
    if (h < 0) h += 2147483647;
    return min + (h % (max - min + 1));
  }

  (function urgency() {
    var el = document.querySelector('.buybox-urgency');
    if (!el) return;

    var path = window.location.pathname;
    var handle = null;
    for (var k in URGENCY) {
      if (Object.prototype.hasOwnProperty.call(URGENCY, k) && path.indexOf(k) !== -1) {
        handle = k;
        break;
      }
    }
    if (!handle) return;

    var cfg = URGENCY[handle];
    var n = seededDaily(cfg.min, cfg.max, cfg.salt);

    /* The dot is a sibling span the section already renders; only the text
       after it is replaced, so the markup and the pulse both survive. */
    var dot = el.querySelector('.buybox-urgency-dot');
    el.innerHTML = (dot ? dot.outerHTML : '') + cfg.text.replace('{n}', n);
  })();

  /* =========================================================================
     4. Cart drawer: cross-sell

     Product data is read from Shopify's own /products/{handle}.js rather than
     seeded from Liquid, so this needs no change to cart-drawer.liquid. One
     fetch per product, cached for the life of the page.

     Two suggestions maximum, and never something already in the cart.
     ========================================================================= */
  var CATALOG = {
    mat_cars: 'mamajoy-baby-play-mat-toys-cars',
    mat_alpha: 'premium-foldable-xpe-baby-play-mat',
    carrier: 'mamajoy-baby-carrier-for-babies-0-3-years-ergonomic-safe-navy-blue',
    pillow: 'mamajoy-baby-feeding-pillow-for-new-born-baby-nursing-pillow-for-breastfeeding'
  };

  /* One order of preference rather than a rule per cart combination.

     The previous table paired each product with its own two suggestions,
     which read as contextual but in a three-product catalogue only ever
     produced "everything except what is already in the cart" in a slightly
     different order. A flat priority says the same thing and says it once.

     Carrier first because it is the designated best seller, then the pillow,
     then the mats. The second mat sits last so it only ever appears when a
     shopper already holds the other three — one mat is not a recommendation
     to somebody holding the other. */
  var PRIORITY = [
    CATALOG.carrier,
    CATALOG.pillow,
    CATALOG.mat_cars,
    CATALOG.mat_alpha
  ];

  var productCache = {};

  function getProduct(handle) {
    if (productCache[handle]) return productCache[handle];
    productCache[handle] = fetch('/products/' + handle + '.js', {
      credentials: 'same-origin'
    }).then(function (r) {
      if (!r.ok) throw new Error('product ' + handle);
      return r.json();
    });
    return productCache[handle];
  }

  function money(paise) {
    return '₹' + Math.round(paise / 100).toLocaleString('en-IN');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function cartHandles() {
    return fetch('/cart.js', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        return cart.items.map(function (i) { return i.handle; });
      });
  }

  /* Everything not already in the cart, in priority order, capped at two.

     Two because the row is a two-column grid and a third tile would sit alone
     on a second row — at these widths that is a worse card, not an extra
     recommendation. With three products in the catalogue, a cart holding one
     leaves exactly two, so the cap is rarely the thing doing the work.

     No special case for an unrecognised cart any more: a handle this file does
     not know simply matches nothing, and the filter then offers the whole
     priority list, which is the right answer rather than a fallback. */
  function pickSuggestions(inCart) {
    return PRIORITY.filter(function (h) {
      return inCart.indexOf(h) === -1;
    }).slice(0, 2);
  }

  /* Monotonic token. Two opens, or the pair of timers below, can have renders
     in flight at once; the newest is the only one whose result is still true,
     so every older one drops its result on the floor when it lands.

     This exists because removing the previous block at the top of the function
     did not work, and the way it failed is worth keeping written down: the
     removal was synchronous but the append was three fetches later. Both runs
     looked, both found nothing to remove, both fetched, both appended — and
     the cart showed the cross-sell twice. A check and the write it guards have
     to be adjacent, so the removal has moved down beside the appendChild. */
  var upsellRun = 0;

  function renderUpsell() {
    var body = document.querySelector('[data-cart-body]');
    if (!body) return;

    var run = ++upsellRun;

    cartHandles().then(function (inCart) {
      /* An empty cart used to return here, so emptying the drawer took the
         cross-sell with it and left a message on a blank panel. It renders in
         that state too now. Nothing else has to change for it to work:
         pickSuggestions filters against what is in the cart, and with nothing
         in the cart it filters nothing out and returns the first two of the
         priority order — the same carrier and pillow a one-item cart is
         offered, from the same list, in the same cards. */
      var picks = pickSuggestions(inCart);
      if (!picks.length) return;

      return Promise.all(picks.map(getProduct)).then(function (products) {
        var rows = products.map(function (p) {
          var v = p.variants && p.variants[0];
          if (!v || !v.available) return '';
          var img = p.featured_image
            ? '<img src="' + esc(p.featured_image) + '&width=320" alt="" loading="lazy">'
            : '';
          /* Both figures, or neither. compare_at_price is Shopify's own field
             and Shopify only carries it when it is genuinely above what is
             charged, so the strike and the percentage describe a real
             reduction rather than a markup invented in order to be crossed
             out. When it is absent the tile shows one price and no badge —
             the percentage is never manufactured to fill the corner. */
          var was = (v.compare_at_price && v.compare_at_price > v.price) ? v.compare_at_price : 0;
          var off = was ? Math.round((was - v.price) / was * 100) : 0;

          /* The carrier's own buy box already calls it a best seller, so the
             cart repeats that claim rather than minting a second one. Keyed on
             the handle, so if the flag is ever wanted elsewhere it is one
             entry here and not a rule spread across the file. */
          var flag = p.handle === CATALOG.carrier ? 'Best seller' : '';

          return '<li class="mj-up-tile">' +
                   '<div class="mj-up-img">' + img +
                     (flag ? '<span class="mj-up-flag">' + flag + '</span>' : '') +
                   '</div>' +
                   '<div class="mj-up-body">' +
                     '<p class="mj-up-title">' + esc(p.title) + '</p>' +
                     /* Price, struck MRP, then the percentage — the order in
                        the reference. All three are rendered; the percentage
                        is plain green text rather than a bordered pill, which
                        is both what the reference does and about 12px
                        narrower, so the row fits one line more often.

                        Every figure is Shopify's own: compare_at_price is
                        only carried when it genuinely exceeds the selling
                        price, so the strike and the percentage describe a
                        real reduction. No compare-at, no strike and no
                        badge. */
                     '<p class="mj-up-prices">' +
                       '<span class="mj-up-price">' + money(v.price) + '</span>' +
                       (was ? '<span class="mj-up-was">' +
                                '<span class="visually-hidden">MRP </span>' + money(was) +
                              '</span>' : '') +
                       (off ? '<span class="mj-up-off">' + off + '% OFF</span>' : '') +
                     '</p>' +
                     /* The store's own outline button, class for class, the
                        same one snippets/product-card.liquid renders in the
                        collection grid: .cta-outline .cta-block with a
                        .btn-label / .btn-pending pair that theme.css swaps on
                        aria-busy. Nothing about how it looks or behaves is
                        defined in mj-features.css any more.

                        Both spans have to stay direct children of the button
                        — theme.css keys the swap on
                        [aria-busy="true"] > .btn-label — and the product name
                        goes inside the label rather than beside it, so a
                        screen reader hears one control named "Add to cart —
                        MamaJoy Baby Carrier" instead of a button and a loose
                        fragment. */
                     '<button type="button" class="cta-outline cta-block mj-up-add" data-mj-add="' + v.id + '">' +
                       '<span class="btn-label">Add to cart' +
                         '<span class="visually-hidden"> — ' + esc(p.title) + '</span>' +
                       '</span>' +
                       '<span class="btn-pending" aria-hidden="true">Adding&hellip;</span>' +
                     '</button>' +
                   '</div>' +
                 '</li>';
        }).join('');

        if (!rows.replace(/\s/g, '')) return;

        /* A newer render started while this one was fetching, so this result
           is already stale. Dropping it here rather than appending it is what
           makes the function safe to call twice. */
        if (run !== upsellRun) return;

        var wrap = document.createElement('div');
        wrap.className = 'mj-upsell';
        wrap.setAttribute('data-mj-upsell', '');

        /* Two claims, on the owner's instruction, and they stand on different
           footings — worth recording which is which.

           "Limited stock" is verified. Every product in this catalogue sits
           between 7 and 10 units with inventory_policy DENY, checked against
           the Admin API, so the store cannot oversell and the badge describes
           the real position. If stock ever runs deep this has to come out; it
           is a fact, not decoration.

           "Lowest price ever" is a claim about price history, which no API
           here exposes and which only the merchant can confirm. It is theirs
           to assert about their own pricing, and they have. If these products
           have ever sold below the current price it is false and must
           change. */
        wrap.innerHTML = '<p class="mj-up-head">' +
                           '<span class="mj-up-head-label">Lowest price ever</span>' +
                           '<span class="mj-up-stock">Limited stock</span>' +
                         '</p>' +
                         '<ul class="mj-up-list">' + rows + '</ul>';

        /* Removal immediately before the append, not at the top of the
           function — see the note on upsellRun.

           querySelectorAll, not querySelector. The run token means only one
           render can reach this line, so in the normal case there is exactly
           one block to clear and the loop runs once. The reason it is a loop
           is the abnormal case: if a block ever did get past the token — a
           future caller, a path not thought of here — singular removal would
           clear one and append a third, and the section would grow by one
           every time the drawer opened. Clearing all of them makes this
           self-correcting instead of self-compounding. */
        var existing = document.querySelectorAll('[data-mj-upsell]');
        for (var i = 0; i < existing.length; i++) {
          existing[i].parentNode.removeChild(existing[i]);
        }

        body.appendChild(wrap);
      });
    }).catch(function () { /* A cross-sell that cannot load is not an error worth showing. */ });
  }

  /* Add without leaving the drawer. Uses the same /cart/add.js theme.js uses,
     then asks theme.js to repaint by clicking its own cart trigger path —
     here, simply re-reading and letting the drawer's own refresh run. */
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest && e.target.closest('[data-mj-add]');
    if (!btn) return;
    e.preventDefault();
    if (btn.getAttribute('aria-busy') === 'true') return;
    btn.setAttribute('aria-busy', 'true');

    fetch('/cart/add.js', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ id: Number(btn.getAttribute('data-mj-add')), quantity: 1 })
    }).then(function (r) {
      if (!r.ok) throw new Error('add failed');
      return r.json();
    }).then(function () {
      /* theme.js owns the drawer's contents. Re-opening it through its own
         trigger makes it re-read /cart.js and repaint, which is the only
         supported way in from outside. */
      var opener = document.querySelector('[data-cart-open]');
      if (opener) opener.click();
      setTimeout(renderUpsell, 400);
    }).catch(function () {
      btn.removeAttribute('aria-busy');
    });
  });

  /* Paint the cross-sell whenever the drawer is opened.

     The delay used to be 500ms, chosen to stay clear of theme.js repainting
     the drawer body. It was doing its job and it was also the bug: the drawer
     opened onto an empty panel and the cross-sell dropped in most of a second
     later, which is what made the section look buried far down the cart
     rather than late.

     The delay only ever guarded a race, so it is now short enough not to be
     seen, and it runs twice. renderUpsell removes any block it previously
     drew before drawing again, so the second call is idempotent — it costs
     one cheap DOM pass and wins if theme.js happened to repaint over the
     first. */
  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) return;
    if (!e.target.closest('[data-cart-open]')) return;
    setTimeout(renderUpsell, 150);
    setTimeout(renderUpsell, 600);
  });

  /* The other half of that delay was the network: /cart.js and two
     /products/{handle}.js had to come back before anything could paint, and on
     a phone that is most of the wait. Warming the product cache while the page
     is idle turns the first drawer open into a render instead of a round trip;
     productCache keeps them for the life of the page, so it happens once.

     Idle only, and never on a metered or slow connection — a cross-sell is not
     worth competing with the page's own loading, and four JSON documents on a
     2G connection is a cost the shopper did not ask for. */
  (function warmProductCache() {
    var c = navigator.connection;
    if (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''))) return;

    var warm = function () {
      Object.keys(CATALOG).forEach(function (k) {
        getProduct(CATALOG[k]).catch(function () { delete productCache[CATALOG[k]]; });
      });
    };

    if (typeof requestIdleCallback === 'function') requestIdleCallback(warm, { timeout: 5000 });
    else setTimeout(warm, 3000);
  })();

  /* =========================================================================
     5. Cash on delivery in the drawer's trust line

     Seven of the store's first eight real customers paid cash on delivery and
     the drawer footer did not mention it.
     ========================================================================= */
  (function codTrust() {
    var foot = document.querySelector('[data-cart-foot]');
    if (!foot) return;
    var line = foot.querySelector('.cart-trust, .cart-drawer-trust, .micro');
    if (!line) return;
    if (line.textContent.toLowerCase().indexOf('cash on delivery') !== -1) return;
    if (line.textContent.toLowerCase().indexOf('secure payments') === -1) return;
    line.textContent = 'Cash on delivery · ' + line.textContent.trim();
  })();

  /* =========================================================================
     6. Pincode: mark the serviceable answer as good news

     theme.js writes the result as one block of HTML with a <br> between the
     answer and its caveat, and sets data-state="error" only when something
     went wrong. There is no success state to hook, so the success case is
     "no error attribute", and the first line is everything before the <br>.

     Wrapped rather than restyled wholesale: only the line that answers "do
     you deliver here" turns green. The line under it is a note about the
     estimate, and colouring it too would spend the signal on the wrong
     sentence.

     A MutationObserver rather than a hook on the button, because the result
     is written by three paths — the button, the Enter key, and the auto-fire
     above — and observing the element catches all three without patching any
     of them. The .mj-pin-ok guard is what stops the observer re-entering on
     its own write.
     ========================================================================= */
  (function pincodeSuccess() {
    var result = document.querySelector('[data-pincode-result]');
    if (!result || typeof MutationObserver === 'undefined') return;

    var TICK = '<span class="mj-pin-tick" aria-hidden="true">' +
      '<svg viewBox="0 0 16 16" fill="none">' +
      '<circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.4"/>' +
      '<path d="M5 8.2l2.1 2.1L11 6.4" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg></span>';

    function decorate() {
      if (result.hidden) return;
      if (result.getAttribute('data-state') === 'error') return;
      if (result.querySelector('.mj-pin-ok')) return;

      var html = result.innerHTML;
      var br = html.search(/<br\s*\/?>/i);
      if (br === -1) return;

      var head = html.slice(0, br);
      var tail = html.slice(br);
      if (!head.trim()) return;

      result.innerHTML = '<span class="mj-pin-ok">' + TICK + head + '</span>' + tail;
    }

    new MutationObserver(decorate).observe(result, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'data-state']
    });

    decorate();
  })();

  /* =========================================================================
     7. Keep the cross-sell present through every repaint

     The cross-sell is painted on the two timers that follow a click on the
     cart trigger. That covers opening the drawer, and it covered every state
     that mattered while the section was hidden on an empty cart.

     It stops covering them the moment the section is meant to survive an
     empty cart, because the most important repaint has no click behind it:
     removing the last item. theme.js re-renders the body itself, the
     cross-sell goes with the innerHTML it was appended to, and nothing fires
     to bring it back until the shopper closes and reopens the drawer. The
     empty state would show the message and the blank panel it was supposed to
     stop showing.

     So the trigger is the repaint rather than the click. Observing the body
     catches every path that rewrites it — renderDrawer, patchTotals, a
     removal, the skeleton on first open — without patching any of them, which
     is the same reason the pincode above uses an observer.

     Termination, since this schedules a write into the thing it observes:
     renderUpsell's own append is a mutation, and the callback it fires finds
     [data-mj-upsell] present and does nothing. One cycle, not a loop. The
     debounce collapses a burst of mutations into a single render, and the run
     token inside renderUpsell drops any result that a newer render has
     already superseded.
     ========================================================================= */
  (function keepUpsell() {
    var body = document.querySelector('[data-cart-body]');
    if (!body || typeof MutationObserver === 'undefined') return;

    var pending = null;

    function ensure() {
      if (document.querySelector('[data-mj-upsell]')) return;
      clearTimeout(pending);
      pending = setTimeout(renderUpsell, 60);
    }

    new MutationObserver(ensure).observe(body, { childList: true, subtree: true });
    ensure();
  })();

  void RM;
})();
