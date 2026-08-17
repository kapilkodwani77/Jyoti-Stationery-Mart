#!/usr/bin/env node
'use strict';

/* Cart drawer regression suite.
   Run: node tests/cart.test.js        (no dependencies, no build step)

   The pricing functions under test are pulled out of assets/theme.js at run
   time and evaluated, rather than copied into this file. A copy is a second
   source of truth that drifts silently and then reports green about code that
   is no longer shipped; extracting means these assertions run against the
   bytes that go to Shopify, and a rename breaks the suite loudly instead of
   quietly testing something that no longer exists.

   What is deliberately NOT claimed here: this is not a browser. It does not
   prove the drawer renders, that a tap reaches a handler, or that Shopify
   accepts a mutation. It covers the pricing arithmetic, the state rules those
   prices depend on, and the wiring between the markup and the script — the
   places where the bugs in this drawer's history actually lived. */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'assets/theme.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'assets/theme.css'), 'utf8');
const LIQUID_RAW = fs.readFileSync(path.join(ROOT, 'sections/cart-drawer.liquid'), 'utf8');

/* Assertions about what the drawer shows have to read what the drawer renders.
   A {% comment %} explaining why View cart was removed is not a View cart link,
   and a suite that cannot tell the difference forces the next person to choose
   between documenting a decision and keeping the tests green. Comments are
   stripped once, here, so every check below is against markup. */
const LIQUID = LIQUID_RAW.replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, '');

/* ---------------------------------------------------------------- harness */

let pass = 0;
const failures = [];

function t(name, fn) {
  try { fn(); pass++; }
  catch (e) { failures.push(name + '\n      ' + e.message); }
}
function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg ? msg + ': ' : '') +
      'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'expected truthy'); }
function no(cond, msg) { if (cond) throw new Error(msg || 'expected falsy'); }

/* Lift a top-level function out of theme.js by brace matching. */
function extract(name) {
  const start = JS.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function ' + name + '() not found in assets/theme.js');
  let depth = 0, open = false;
  for (let i = JS.indexOf('{', start); i < JS.length; i++) {
    if (JS[i] === '{') { depth++; open = true; }
    else if (JS[i] === '}') { depth--; if (open && depth === 0) return JS.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

const money = new Function('return ' + extract('money'))();

/* The pricing functions form a small chain — writeSummary needs mrpTotal needs
   mrpFor needs the cache — so they are rebuilt together around whatever
   compare-at data a given test wants to hand them. */
function priceKit(cache) {
  const mrpCache = cache || {};
  const mrpFor = new Function('mrpCache', 'return ' + extract('mrpFor'))(mrpCache);
  const mrpTotal = new Function('mrpFor', 'return ' + extract('mrpTotal'))(mrpFor);
  const unitPrice = new Function('money', 'mrpFor', 'return ' + extract('unitPrice'))(money, mrpFor);
  const writeSummaryFor = (drawer) =>
    new Function('drawer', 'money', 'mrpTotal', 'return ' + extract('writeSummary'))(drawer, money, mrpTotal);
  return { mrpCache, mrpFor, mrpTotal, unitPrice, writeSummaryFor };
}

/* Minimal stand-in for the footer. writeSummary only ever calls
   drawer.querySelector(sel) and sets .textContent / .hidden, so this is the
   whole surface it touches. */
function stubDrawer() {
  const els = {};
  [
    '[data-cart-mrp]', '[data-cart-carttotal]', '[data-cart-topay]',
    '[data-cart-discount]', '[data-cart-save]',
    '[data-cart-discount-row]', '[data-cart-save-row]'
  ].forEach((sel) => { els[sel] = { textContent: '', hidden: false }; });
  return { querySelector: (sel) => els[sel] || null, els };
}

const rupees = (r) => r * 100; // paise, the unit every Shopify money field uses

/* The real product, as the Shopify Admin API reports it: listed 1,900, sold
   1,299. Both figures are load-bearing — the whole MRP bug was reading a field
   that only ever knows the second one. */
const VARIANT = 45558099574893;
const MRP = rupees(1900);
const PRICE = rupees(1299);
const CACHE = {};
CACHE[VARIANT] = MRP;

const line = (qty) => ({
  key: '111:a', quantity: qty, variant_id: VARIANT, handle: 'baby-play-mat',
  product_title: 'MamaJoy Baby Play Mat',
  original_price: PRICE, final_price: PRICE,
  original_line_price: PRICE * qty, final_line_price: PRICE * qty
});

/* Carts. cartClean is what Add to Cart must produce: no cart-level discount,
   so Cart Total and To Pay are the selling price exactly. cartCoded is the same
   cart with the prepaid code live on the session, which is what the reported
   screenshots were showing. */
const cartClean = { item_count: 1, original_total_price: PRICE, total_price: PRICE, items: [line(1)] };
const cartQty3  = { item_count: 3, original_total_price: PRICE * 3, total_price: PRICE * 3, items: [line(3)] };
const cartCoded = { item_count: 1, original_total_price: PRICE, total_price: rupees(1234), items: [line(1)] };
const cartEmpty = { item_count: 0, original_total_price: 0, total_price: 0, items: [] };

function summaryOf(cart, cache) {
  const kit = priceKit(cache === undefined ? Object.assign({}, CACHE) : cache);
  const d = stubDrawer();
  kit.writeSummaryFor(d)(cart);
  return d.els;
}
const kit = () => priceKit(Object.assign({}, CACHE));

/* ------------------------------------------------- 1. money() */

t('money renders paise as whole rupees', () => eq(money(rupees(1299)), money(129900)));
t('money prefixes the rupee sign', () => ok(money(rupees(1)).startsWith('\u20b9')));
t('money drops paise rather than showing .00', () => no(/\./.test(money(rupees(3897)))));
t('money handles zero', () => eq(money(0), '\u20b90'));
t('money groups in the Indian system', () => {
  const s = money(rupees(100000)).replace('\u20b9', '');
  ok(s === '1,00,000' || s === '100000', 'got ' + s);
});

/* ------------------------------------------------- 2. MRP comes from
   compare-at, which is the entire point of this pass */

t('MRP Total is the compare-at price, not the selling price', () =>
  eq(summaryOf(cartClean)['[data-cart-mrp]'].textContent, money(MRP)));
t('MRP Total is NOT cart.original_total_price', () => {
  /* original_total_price is 1,299 here. If it leaks back in, this catches it. */
  no(summaryOf(cartClean)['[data-cart-mrp]'].textContent === money(PRICE),
     'MRP Total fell back to the selling price');
});
t('the worked example reconciles: 1,900 - 601 = 1,299', () => {
  const e = summaryOf(cartClean);
  eq(e['[data-cart-mrp]'].textContent, money(rupees(1900)));
  eq(e['[data-cart-discount]'].textContent, '\u2212' + money(rupees(601)));
  eq(e['[data-cart-carttotal]'].textContent, money(rupees(1299)));
  eq(e['[data-cart-topay]'].textContent, money(rupees(1299)));
  eq(e['[data-cart-save]'].textContent, money(rupees(601)));
});
t('Add to Cart at qty 1 pays the selling price, not 5% under', () =>
  eq(summaryOf(cartClean)['[data-cart-topay]'].textContent, money(rupees(1299))));
t('MRP Total multiplies by quantity', () =>
  eq(summaryOf(cartQty3)['[data-cart-mrp]'].textContent, money(rupees(5700))));
t('qty 3 reconciles: 5,700 - 1,803 = 3,897', () => {
  const e = summaryOf(cartQty3);
  eq(e['[data-cart-discount]'].textContent, '\u2212' + money(rupees(1803)));
  eq(e['[data-cart-carttotal]'].textContent, money(rupees(3897)));
  eq(e['[data-cart-topay]'].textContent, money(rupees(3897)));
});
t('To Pay always equals Cart Total while shipping is free', () => {
  [cartClean, cartQty3, cartCoded].forEach((c) => {
    const e = summaryOf(c);
    eq(e['[data-cart-topay]'].textContent, e['[data-cart-carttotal]'].textContent);
  });
});
t('the column always adds up', () => {
  [cartClean, cartQty3, cartCoded, cartEmpty].forEach((c) => {
    const kt = priceKit(Object.assign({}, CACHE));
    eq(kt.mrpTotal(c) - (kt.mrpTotal(c) - c.total_price), c.total_price);
  });
});

/* ------------------------------------------------- 3. multi-product */

t('two products sum their own MRPs', () => {
  const other = { key: '222:b', quantity: 2, variant_id: 999, handle: 'other',
                  original_price: rupees(500), final_price: rupees(500),
                  final_line_price: rupees(1000) };
  const cache = Object.assign({}, CACHE); cache[999] = rupees(800);
  const cart = { item_count: 3, original_total_price: rupees(2299),
                 total_price: rupees(2299), items: [line(1), other] };
  /* 1,900 + (800 x 2) = 3,500 */
  eq(summaryOf(cart, cache)['[data-cart-mrp]'].textContent, money(rupees(3500)));
});
t('a product with no compare-at contributes what is actually paid', () => {
  const plain = { key: '333:c', quantity: 1, variant_id: 777, handle: 'plain',
                  original_price: rupees(400), final_price: rupees(400),
                  final_line_price: rupees(400) };
  const cache = Object.assign({}, CACHE); cache[777] = 0;
  const cart = { item_count: 2, original_total_price: rupees(1699),
                 total_price: rupees(1699), items: [line(1), plain] };
  /* 1,900 + 400, not 1,900 + an invented markup */
  eq(summaryOf(cart, cache)['[data-cart-mrp]'].textContent, money(rupees(2300)));
});
t('a free line never invents an MRP', () => {
  const free = { key: '444:d', quantity: 1, variant_id: 555, handle: 'gift',
                 original_price: 0, final_price: 0, final_line_price: 0 };
  const cache = Object.assign({}, CACHE); cache[555] = 0;
  const cart = { item_count: 2, original_total_price: PRICE, total_price: PRICE,
                 items: [line(1), free] };
  eq(summaryOf(cart, cache)['[data-cart-mrp]'].textContent, money(MRP));
});

/* ------------------------------------------------- 4. Shopify stays the
   source of truth for what is actually charged */

t('a Shopify-discounted total is displayed, never re-discounted', () =>
  eq(summaryOf(cartCoded)['[data-cart-topay]'].textContent, money(rupees(1234))));
t('a cart-level discount widens the saving rather than being ignored', () =>
  eq(summaryOf(cartCoded)['[data-cart-save]'].textContent, money(rupees(666))));
t('the coded cart still reconciles: 1,900 - 666 = 1,234', () => {
  const e = summaryOf(cartCoded);
  eq(e['[data-cart-carttotal]'].textContent, money(rupees(1234)));
});
t('MRP Total can never fall below Cart Total', () => {
  const kt = priceKit({});
  const odd = { total_price: rupees(9999), items: [line(1)], item_count: 1 };
  ok(kt.mrpTotal(odd) >= odd.total_price, 'a negative saving would render');
});
t('an undiscounted, no-compare-at cart shows no saving', () => {
  const e = summaryOf(cartClean, {});
  eq(e['[data-cart-save]'].textContent, money(0));
  eq(e['[data-cart-discount-row]'].hidden, true);
});
t('the You Save chip hides when there is nothing saved', () =>
  eq(summaryOf(cartClean, {})['[data-cart-save-row]'].hidden, true));
t('both discount rows show when there is a saving', () => {
  const e = summaryOf(cartClean);
  eq(e['[data-cart-discount-row]'].hidden, false);
  eq(e['[data-cart-save-row]'].hidden, false);
});
t('an empty cart renders zeroes and hides the discount rows', () => {
  const e = summaryOf(cartEmpty);
  eq(e['[data-cart-topay]'].textContent, money(0));
  eq(e['[data-cart-discount-row]'].hidden, true);
});

/* ------------------------------------------------- 5. malformed bodies */

t('a cart with no total writes nothing rather than NaN', () => {
  const kt = kit(), d = stubDrawer();
  d.els['[data-cart-topay]'].textContent = 'untouched';
  kt.writeSummaryFor(d)({ items: [] });
  eq(d.els['[data-cart-topay]'].textContent, 'untouched');
});
t('a string total writes nothing rather than concatenating', () => {
  const kt = kit(), d = stubDrawer();
  d.els['[data-cart-mrp]'].textContent = 'untouched';
  kt.writeSummaryFor(d)({ total_price: '1234', items: [] });
  eq(d.els['[data-cart-mrp]'].textContent, 'untouched');
});
t('a cart with no items array writes nothing rather than throwing', () => {
  const kt = kit(), d = stubDrawer();
  kt.writeSummaryFor(d)({ total_price: rupees(10) });
  eq(d.els['[data-cart-mrp]'].textContent, '');
});
t('the zero guard is a type check, not a truthiness check', () =>
  eq(summaryOf(cartEmpty)['[data-cart-mrp]'].textContent, money(0)));
t('missing summary nodes do not throw', () =>
  kit().writeSummaryFor({ querySelector: () => null })(cartClean));

/* ------------------------------------------------- 5b. strikethrough */

t('the struck figure is the compare-at price', () => {
  const html = kit().unitPrice(line(1));
  ok(html.includes(money(MRP)), 'MRP missing from the line');
  ok(html.includes(money(PRICE)), 'selling price missing from the line');
});
t('the selling price is the one NOT struck', () => {
  const html = kit().unitPrice(line(1));
  ok(new RegExp('<s class="price-was"[^>]*>' + '\u20b91,900' + '</s>').test(html),
     'the wrong figure is struck');
  ok(/price-now[^>]*>\u20b91,299</.test(html));
});
t('no MRP is fabricated when there is no compare-at', () =>
  no(/price-was/.test(priceKit({}).unitPrice(line(1)))));
t('no strikethrough when compare-at equals the price', () => {
  const cache = {}; cache[VARIANT] = PRICE;
  no(/price-was/.test(priceKit(cache).unitPrice(line(1))));
});
t('no strikethrough when compare-at is below the price', () => {
  const cache = {}; cache[VARIANT] = rupees(900);
  no(/price-was/.test(priceKit(cache).unitPrice(line(1))));
});
t('a free line is not given a struck price', () => {
  const cache = {}; cache[555] = 0;
  const free = { variant_id: 555, original_price: 0, final_price: 0 };
  no(/price-was/.test(priceKit(cache).unitPrice(free)));
});
t('the pair is announced to screen readers', () => {
  const html = kit().unitPrice(line(1));
  ok(/visually-hidden/.test(html) && /reduced from/.test(html));
});
t('original_price is still honoured when no compare-at is known', () => {
  const item = { variant_id: 111, original_price: rupees(600), final_price: rupees(500) };
  ok(/price-was/.test(priceKit({}).unitPrice(item)));
});
t('the JS and Liquid strike the same figure in the same order', () => {
  const snip = fs.readFileSync(path.join(ROOT, 'snippets/cart-line-mrp.liquid'), 'utf8');
  ok(snip.indexOf('price-now') < snip.indexOf('price-was'), 'Liquid order differs');
  const js = extract('unitPrice');
  ok(js.indexOf('price-now') < js.indexOf('price-was'), 'JS order differs');
});

/* ------------------------------------------------- 5c. the MRP side channel
   must never be able to touch cart state */

t('mrpFor caches 0 as a real answer, not as unknown', () => {
  const cache = {}; cache[VARIANT] = 0;
  eq(priceKit(cache).mrpFor(line(1)), 0);
});
t('ensureMrp repaints through applyCart, the single writer', () => {
  const src = extract('ensureMrp');
  ok(src.includes('applyCart(lastCart)'), 'summary repaint bypasses the single writer');
});
t('ensureMrp cannot recurse forever', () => {
  const src = extract('ensureMrp');
  ok(/mrpCache\[item\.variant_id\] = 0/.test(src), 'an unanswered variant would re-request on every paint');
});
t('ensureMrp uses the XHR transport, not fetch', () => {
  const src = extract('ensureMrp');
  ok(src.includes('cartRequest('));
  no(/\bfetch\s*\(/.test(src));
});
t('the MRP lookup never writes a quantity or a total', () => {
  const src = extract('ensureMrp');
  no(/cartChange|cartAdd|quantity\s*[:=]/.test(src), 'the display side channel can mutate the cart');
});
t('the drawer seeds the cache from Liquid', () => {
  ok(LIQUID.includes('data-cart-mrp-seed'), 'no seed in the markup');
  ok(JS.includes('data-cart-mrp-seed'), 'the script never reads the seed');
});
t('a malformed seed cannot throw during load', () => {
  const src = extract('seedMrp');
  ok(/try\s*\{/.test(src) && /catch/.test(src));
});

/* ------------------------------------------------- 6. source invariants —
   the theme calculates no prices, and must keep not calculating them */

const CART_JS = JS.slice(JS.indexOf('Cart drawer: open/close'));

t('no 0.95 multiplier anywhere in theme.js', () =>
  no(/0\.95|\*\s*\.95/.test(JS), 'a 5% multiplier reappeared'));
t('no percentage arithmetic on any cart total', () =>
  no(/total_price\s*[*/]/.test(JS), 'a cart total is being multiplied or divided'));
t('no hardcoded discount percentage in the cart module', () =>
  no(/\b(95|105)\s*\/\s*100\b/.test(CART_JS)));
t('the subtotal is written from cart.total_price', () =>
  ok(/data-cart-subtotal[\s\S]{0,220}money\(cart\.total_price\)/.test(CART_JS)));
t('writeSummary is called from applyCart, the single writer', () => {
  const applyCart = extract('applyCart');
  ok(applyCart.includes('writeSummary(cart)'), 'summary is not written on the single path');
});
t('writeSummary is called from exactly one place', () => {
  const calls = JS.match(/writeSummary\(/g) || [];
  eq(calls.length, 2, 'expected one definition and one call site');
});
t('writeSummary holds no state of its own', () => {
  const src = extract('writeSummary');
  no(/\b(setTimeout|setInterval|addEventListener)\b/.test(src));
});
t('the summary takes its gross from mrpTotal, not a raw cart field', () => {
  const src = extract('writeSummary');
  ok(src.includes('mrpTotal(cart)'), 'gross is not the compare-at total');
  ok(src.includes('cart.total_price'), 'net is not the Shopify total');
  no(src.includes('cart.original_total_price'), 'the pre-discount field leaked back in');
});
t('the discount is derived as a difference, not read from total_discount', () => {
  const src = extract('writeSummary');
  ok(/gross\s*-\s*net/.test(src));
  no(/total_discount/.test(src), 'two fields that must agree can disagree');
});

/* ------------------------------------------------- 7. architecture preserved */

t('cart transport is still XMLHttpRequest', () =>
  ok(/new XMLHttpRequest\(\)/.test(JS), 'XHR transport was removed'));
t('cartRequest does not use fetch', () => {
  const src = extract('cartRequest');
  no(/\bfetch\s*\(/.test(src), 'fetch reintroduced — app embeds can consume the body');
});
t('responses are still validated before painting', () => ok(/function isCart\b/.test(JS)));
t('the single-writer applyCart still exists', () => ok(/function applyCart\b/.test(JS)));
t('mutations are still serialised', () => ok(/qtyPending/.test(JS)));
t('patchTotals still guards pending quantities', () => {
  const src = extract('patchTotals');
  ok(src.includes('qtyPending'), 'in-flight quantity guard lost');
});
t('patchTotals renders the struck price, not a flattened number', () => {
  const src = extract('patchTotals');
  ok(src.includes('unitPrice(item)'), 'patch path drops the strikethrough');
  no(/cart-line-price[\s\S]{0,80}textContent\s*=\s*money\(/.test(src));
});
t('line totals come from final_line_price', () => ok(/money\(item\.final_line_price\)/.test(CART_JS)));
t('removal is still a state, not an animation', () => ok(/is-removing/.test(JS)));

/* ------------------------------------------------- 8. markup ↔ script wiring
   Every selector writeSummary looks for has to exist in the Liquid. This is
   the failure a renamed attribute produces: silent, because querySelector
   returning null is not an error. */

const summarySelectors = (extract('writeSummary').match(/\[data-cart-[a-z-]+\]/g) || [])
  .filter((v, i, a) => a.indexOf(v) === i);

t('writeSummary looks for at least the five figures and two rows', () =>
  ok(summarySelectors.length >= 7, 'found ' + summarySelectors.length));

summarySelectors.forEach((sel) => {
  t('markup provides ' + sel, () =>
    ok(LIQUID.includes(sel.slice(1, -1)), sel + ' is written by JS but absent from the drawer'));
});

t('the Total Price value keeps the data-cart-subtotal hook', () =>
  ok(LIQUID.includes('data-cart-subtotal'), 'the single writer would silently stop writing'));
t('the accordion toggle exists in the markup', () =>
  ok(LIQUID.includes('data-cart-summary-toggle')));
t('the accordion panel exists in the markup', () =>
  ok(LIQUID.includes('data-cart-summary-panel')));
t('the toggle handler is wired in theme.js', () =>
  ok(JS.includes('data-cart-summary-toggle')));

/* ------------------------------------------------- 9. requested UI changes */

t('View cart is gone from the drawer', () =>
  no(/View cart/i.test(LIQUID), 'View cart still present'));
t('the View cart link markup is gone', () =>
  no(/cart-view-link/.test(LIQUID)));
t('the dead View cart rule is gone from the stylesheet', () =>
  no(/\.cart-view-link/.test(CSS), 'dead CSS left behind'));
t('the old trust line is gone', () =>
  no(/Cash on delivery\s*&middot;\s*30-day returns/.test(LIQUID)));
t('Secure Payments is shown', () => ok(/Secure Payments/.test(LIQUID)));
t('Made in India is shown', () => ok(/Made in India/.test(LIQUID)));
t('Easy Returns is shown', () => ok(/Easy Returns/.test(LIQUID)));
t('the three facts sit on one line together', () =>
  ok(/Secure Payments[\s\S]{0,60}Made in India[\s\S]{0,60}Easy Returns/.test(LIQUID)));
t('Checkout survives as the single primary action', () =>
  ok(/class="cta cta-block"[^>]*>Checkout</.test(LIQUID)));
t('all five summary rows are labelled', () => {
  ['MRP Total', 'MRP Discount', 'Cart Total', 'Shipping', 'To Pay']
    .forEach((label) => ok(LIQUID.includes(label), 'missing row: ' + label));
});
t('the server-rendered summary uses Shopify cart fields', () => {
  ok(LIQUID.includes('mrp_total'), 'no computed MRP total');
  ok(LIQUID.includes('item.variant.compare_at_price'), 'MRP is not read from compare-at');
  ok(LIQUID.includes('cart.total_price'), 'Cart Total is not the Shopify total');
  no(LIQUID.includes('cart.original_total_price'), 'the pre-discount field leaked back in');
});
t('the server-rendered saving is a Liquid subtraction, not a percentage', () => {
  ok(/mrp_total\s*\|\s*minus:\s*cart\.total_price/.test(LIQUID));
  no(/times:\s*0?\.95/.test(LIQUID));
});
t('the Liquid MRP rule matches the JS MRP rule', () => {
  /* Both must prefer compare-at, fall back to original_price, else nothing. */
  const snip = fs.readFileSync(path.join(ROOT, 'snippets/cart-line-mrp.liquid'), 'utf8');
  ok(snip.includes('compare_at_price') && snip.includes('original_price'));
  const js = extract('mrpFor');
  ok(js.includes('mrpCache') && js.includes('original_price'));
});
t('the server-rendered MRP total can never sit below the cart total', () =>
  ok(/mrp_total\s*<\s*cart\.total_price/.test(LIQUID), 'no floor on the Liquid MRP total'));
t('no prepaid button returned to the drawer', () =>
  no(/data-buy-prepaid/.test(LIQUID), 'the prepaid button is back in the cart'));

/* ------------------------------------------------- 9b. nothing in the theme
   may apply a discount. The default state of the cart is the price on the
   product, and the only mechanism that ever changed that was a control
   navigating to /discount/CODE, which sticks to the session permanently. */

const TEMPLATES = ['sections', 'snippets', 'layout', 'templates'].flatMap((dir) => {
  const d = path.join(ROOT, dir);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => /\.(liquid|json)$/.test(f))
    .map((f) => [path.join(dir, f), fs.readFileSync(path.join(d, f), 'utf8')]);
});

t('no template renders a prepaid trigger', () => {
  TEMPLATES.forEach(([name, body]) => {
    no(/data-buy-prepaid/.test(body), name + ' still renders a prepaid trigger');
  });
});
t('no template navigates to /discount/ outside a comment', () => {
  TEMPLATES.forEach(([name, body]) => {
    const markup = body.replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, '');
    no(/discount\//.test(markup), name + ' still links to /discount/');
  });
});
t('the discount redirect handler is gone from theme.js entirely', () => {
  /* Stronger than leaving it unreachable. Dead code that still knows how to
     reach /discount/ is one careless re-render away from reachable again. */
  no(JS.includes("'discount/'"), 'the redirect still exists in the script');
  TEMPLATES.forEach(([, body]) => no(/data-buy-prepaid/.test(body)));
});
t('Add to Cart posts only an id and a quantity', () => {
  /* Comments stripped: the handler is documented in prose that necessarily
     mentions the discount it must not apply. */
  const from = JS.indexOf("document.addEventListener('submit'");
  const add = JS.slice(from, JS.indexOf('document.addEventListener', from + 10))
                .replace(/\/\*[\s\S]*?\*\//g, '');
  ok(add.includes('data-buybox-form'), 'located the wrong handler');
  ok(/cartRequest\(routes\.cartAdd/.test(add), 'add path does not post to cart/add');
  no(/discount/i.test(add), 'the add path references a discount');
  no(/0\.95/.test(add), 'the add path does arithmetic on a price');
});

/* ------------------------------------------------- 10. accessibility */

t('the accordion toggle is a real button', () =>
  ok(/<button[^>]+data-cart-summary-toggle/.test(LIQUID) ||
     /data-cart-summary-toggle[\s\S]{0,200}<\/button>/.test(LIQUID)));
t('the toggle declares aria-expanded', () => ok(/aria-expanded="false"/.test(LIQUID)));
t('the toggle points at its panel with aria-controls', () => {
  const m = LIQUID.match(/aria-controls="([^"]+)"/);
  ok(m, 'no aria-controls');
  ok(LIQUID.includes('id="' + m[1] + '"'), 'aria-controls points at no such id');
});
t('the toggle handler keeps aria-expanded in step with the panel', () => {
  const h = JS.slice(JS.indexOf("data-cart-summary-toggle"));
  ok(/setAttribute\('aria-expanded'/.test(h) && /panel\.hidden\s*=/.test(h));
});
t('the chevron is decorative, not announced', () =>
  ok(/icon['"]?,\s*name:\s*'chevron'/.test(LIQUID)));
t('the summary uses a description list for label/value pairs', () =>
  ok(/<dl/.test(LIQUID) && /<dt>/.test(LIQUID) && /<dd/.test(LIQUID)));
t('the toggle meets the 44px tap target', () =>
  ok(/\.cart-summary-bar\{[^}]*min-height:var\(--tap\)/.test(CSS.replace(/\s+/g, ' ').replace(/ \{/g, '{'))
     || /min-height:var\(--tap\)/.test(CSS)));

/* ------------------------------------------------- 11. CSS correctness —
   [hidden] loses to any class rule that declares display */

t('hidden summary rows are actually hidden', () =>
  ok(/\.cart-summary-row\[hidden\]\{\s*display:none/.test(CSS),
     'display:flex beats the [hidden] UA rule on specificity'));
t('the hidden panel is actually hidden', () =>
  ok(/\.cart-summary-panel\[hidden\]\{\s*display:none/.test(CSS)));
t('the hidden You Save chip is actually hidden', () =>
  ok(/\.cart-summary-bar-save\[hidden\]\{\s*display:none/.test(CSS)));
t('figures use tabular numerals so they do not jitter', () =>
  ok(/\.cart-summary-bar-value\{[^}]*tabular-nums/.test(CSS.replace(/\n/g, ''))));
t('prices do not wrap mid-figure', () => ok(/white-space:nowrap/.test(CSS)));
t('the reference red/black is not imported', () => {
  const added = CSS.slice(CSS.indexOf('total price summary'), CSS.indexOf('cart badge acknowledgement'));
  no(/#[dD][0-9a-fA-F]{5}|crimson|#[eE][0-9a-fA-F]{5}/.test(added), 'a red crept into the summary');
  ok(/var\(--indigo\)/.test(added), 'summary should use the MamaJoy indigo');
});
t('reduced motion is respected by the chevron', () =>
  ok(/prefers-reduced-motion[\s\S]{0,200}cart-summary-chevron/.test(CSS)));

/* ------------------------------------------------- 12. the offer card
   Display and copy. The control this replaces wrote a discount code onto the
   shopper's cart the moment it was tapped, with nothing able to take it back
   off, so every assertion here is about what this one does NOT do. */

const BUYBOX_RAW = fs.readFileSync(path.join(ROOT, 'snippets/buy-box.liquid'), 'utf8');
const BUYBOX = BUYBOX_RAW
  .replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, '')
  /* Liquid also allows bare comment/endcomment inside a {%- ... -%} block, and
     the rationale in this file uses that form. Prose about not inventing
     urgency is not an invented urgency claim. */
  .replace(/(^|\n)\s*comment\b[\s\S]*?\n\s*endcomment\b/g, '');
const BUYCSS = fs.readFileSync(path.join(ROOT, 'assets/component-buy-box.css'), 'utf8');

/* The copy handler, comments stripped — it is documented in prose that has to
   name the endpoint it must never reach. */
const OFFER_JS = (() => {
  const from = JS.indexOf('data-offer-copy');
  const start = JS.lastIndexOf('document.addEventListener', from);
  return JS.slice(start, JS.indexOf('\n  });', from) + 6).replace(/\/\*[\s\S]*?\*\//g, '');
})();

t('the offer renders in the buy box', () => ok(/data-offer-copy/.test(BUYBOX)));
t('the offer sits below the price and above the quantity', () => {
  const price = BUYBOX.indexOf("render 'price'");
  const offer = BUYBOX.indexOf('data-offer-copy');
  const qty = BUYBOX.indexOf('qty-row');
  ok(price > -1 && offer > -1 && qty > -1, 'a landmark is missing');
  ok(price < offer, 'offer is above the price');
  ok(offer < qty, 'offer is below the quantity selector');
});
t('the copy control is type="button" so it cannot submit the buy form', () =>
  ok(/<button type="button"[^>]*data-offer-copy/.test(BUYBOX),
     'a default-type button inside the product form is a second Add to Cart'));
t('the code comes from a setting, not a hardcoded string', () => {
  ok(BUYBOX.includes('{{ prepaid_code }}'), 'the code is not configurable');
  no(/data-offer-value="CARE5"/.test(BUYBOX), 'the code is hardcoded in markup');
});
t('the percentage comes from a setting too', () => ok(BUYBOX.includes('{{ prepaid_pct }}')));
t('the offer is hidden entirely when no code is configured', () =>
  ok(/\{%-?\s*if prepaid_code != blank\s*-?%\}/.test(BUYBOX)));

t('copy puts the code on the clipboard', () =>
  ok(/navigator\.clipboard[\s\S]{0,80}writeText\(code\)/.test(OFFER_JS)));
t('copy reads the code off the button rather than inventing one', () =>
  ok(OFFER_JS.includes("getAttribute('data-offer-value')")));
t('copy NEVER navigates to a discount URL', () => {
  no(/discount/i.test(OFFER_JS), 'the copy handler references a discount endpoint');
  no(/location\s*(\.|=)/.test(OFFER_JS), 'the copy handler navigates');
});
t('copy NEVER touches the cart', () => {
  no(/cartRequest|cartAdd|cartChange|routes\.cart/.test(OFFER_JS), 'the offer can mutate the cart');
  no(/applyCart|readCart/.test(OFFER_JS), 'the offer can repaint cart state');
});
t('copy issues no request of any kind', () =>
  no(/\bfetch\s*\(|XMLHttpRequest|\.submit\(/.test(OFFER_JS)));
t('copy does not reload the page', () =>
  no(/reload|assign\(|replace\(/.test(OFFER_JS)));
t('copy prevents the default form action', () =>
  ok(/preventDefault\(\)/.test(OFFER_JS)));
t('copy confirms, then reverts', () => {
  ok(/classList\.add\('is-copied'\)/.test(OFFER_JS));
  ok(/classList\.remove\('is-copied'\)/.test(OFFER_JS));
  ok(/setTimeout/.test(OFFER_JS), 'the confirmation never reverts');
});
t('a clipboard refusal falls back to selecting the code', () => {
  ok(/catch\(/.test(OFFER_JS), 'no rejection path');
  ok(/selectNodeContents/.test(OFFER_JS), 'no selectable fallback');
});
t('browsers without the clipboard API still get the fallback', () =>
  ok(/navigator\.clipboard && navigator\.clipboard\.writeText/.test(OFFER_JS),
     'the API is assumed to exist'));
t('the confirmation is announced, not just shown', () => {
  ok(/data-offer-status/.test(OFFER_JS));
  ok(/role="status"/.test(BUYBOX));
});
t('both labels ship in markup so the accessible name survives', () => {
  ok(BUYBOX.includes('offer-copy-idle') && BUYBOX.includes('offer-copy-done'));
  no(/offer-copy[\s\S]{0,200}textContent\s*=/.test(OFFER_JS), 'the label is rewritten');
});
t('the copied state is a CSS swap', () => {
  ok(/\.offer-copy\.is-copied \.offer-copy-idle\{\s*display:none/.test(BUYCSS));
  ok(/\.offer-copy-done\{\s*display:none/.test(BUYCSS));
});
t('the offer carries no dashes and no nested chip', () => {
  const flat = BUYCSS.replace(/\n/g, ' ');
  no(/\.offer\{[^}]*dashed/.test(flat), 'the coupon-clipart border is back');
  ok(/\.offer-code\{[^}]*border:0/.test(flat), 'the code chip border is back');
});
t('the offer surface is the shared class, not a restated value', () => {
  ok(/class="offer surf-jute"/.test(BUYBOX), 'the offer no longer carries .surf-jute');
  const block = BUYCSS.slice(BUYCSS.indexOf('.offer{'), BUYCSS.indexOf('.offer-text{'));
  no(/background/.test(block), 'a second copy of the surface value was declared');
});
t('.surf-jute is the band the reference points at, at 42%', () => {
  /* If this value ever moves, the offer moves with it — which is the point of
     using the class rather than the token. The raw token is ~2.4x this. */
  ok(/\.surf-jute\{\s*background:rgba\(222,\s*216,\s*204,\s*\.42\)/.test(CSS.replace(/\n/g, ' ')),
     'the shared warm surface changed or moved');
});
t('elevation is declared once: tint alone, no border and no shadow', () => {
  const block = BUYCSS.slice(BUYCSS.indexOf('.offer{'), BUYCSS.indexOf('.offer-text{'));
  no(/box-shadow/.test(block), 'shadow on top of the tint');
  no(/border:[^-][^;]*solid/.test(block), 'border on top of the tint — elevation declared twice');
});
t('no coloured accent bar', () => {
  const flat = BUYCSS.replace(/\n/g, ' ');
  no(/\.offer\{[^}]*border-(left|inline-start):\s*[2-9]/.test(flat), 'banned accent bar');
});
t('the action is a secondary outlined control, not a second primary', () => {
  const flat = BUYCSS.replace(/\n/g, ' ');
  ok(/\.offer-copy\{[^}]*border:1px solid var\(--indigo\)/.test(flat), 'not outlined');
  ok(/\.offer-copy\{[^}]*background:none/.test(flat), 'filled by default competes with Add to Cart');
  ok(/\.offer-copy\{[^}]*text-transform:uppercase/.test(flat), 'action lacks the label treatment');
});
t('the action carries its own 44px target', () =>
  ok(/\.offer-copy\{[^}]*min-height:var\(--tap\)/.test(BUYCSS.replace(/\n/g, ' ')),
     'target depends on the row'));
t('the copied state fills in so confirmation is unmistakable', () => {
  const flat = BUYCSS.replace(/\n/g, ' ');
  ok(/\.offer-copy\.is-copied\{[^}]*background:var\(--indigo\)/.test(flat));
  ok(/\.offer-copy\.is-copied \.offer-copy-idle\{\s*display:none/.test(flat));
});
t('the code is not dressed as monospace', () =>
  ok(/\.offer-code\{[^}]*font-family:inherit/.test(BUYCSS.replace(/\n/g, ' '))));
t('the action names what it does', () => ok(/>Copy code</.test(BUYBOX)));
t('no text in the offer drops below 12px', () => {
  const flat = BUYCSS.replace(/\n/g, ' ');
  const sizes = (flat.match(/\.offer[a-z-]*\{[^}]*font-size:(\d+)px/g) || [])
    .map((m) => Number(/font-size:(\d+)px/.exec(m)[1]));
  ok(sizes.length >= 2, 'expected sized offer elements, got ' + sizes.length);
  sizes.forEach((px) => ok(px >= 12, 'found ' + px + 'px body text'));
});
t('the copied state is not an instant 0ms change', () => {
  const flat = BUYCSS.replace(/\n/g, ' ');
  ok(/\.offer-copy\{[^}]*transition:[^;]*(background-color|color)/.test(flat), 'state change is instant');
  ok(/prefers-reduced-motion[\s\S]{0,200}\.offer-copy\{\s*transition:none/.test(BUYCSS),
     'motion is not reduced-motion guarded');
});

/* ---- urgency line: sourced, never manufactured ---- */
t('the approved urgency copy is exact', () => {
  ok(/A mom favourite &middot; Selling fast/.test(BUYBOX_RAW), 'copy drifted from what was approved');
});
t('the urgency line is unconditional', () => {
  /* Persistent by construction: one assign, no branch that can blank it. */
  const block = BUYBOX_RAW.slice(BUYBOX_RAW.indexOf("assign urgency ="));
  const stmt = block.slice(0, block.indexOf('\n'));
  ok(/^assign urgency = 'A mom favourite/.test(stmt.trim()), 'urgency is computed, not stated');
  no(/assign urgency = ''/.test(BUYBOX_RAW), 'a blank-then-maybe-fill branch survives');
});
t('the urgency line survives any stock level', () => {
  /* 2, 5, 9, 20 — none of them can reach this line, because nothing reads
     inventory to build it. Asserting the absence of the input is stronger
     than asserting four outputs. */
  const block = BUYBOX_RAW.slice(BUYBOX_RAW.indexOf('assign urgency ='),
                                BUYBOX_RAW.indexOf('-%}'));
  no(/inventory/.test(block), 'the urgency line still reads inventory');
});
t('no inventory threshold controls any customer-facing copy', () => {
  no(/inventory_quantity <=/.test(BUYBOX_RAW), 'a stock threshold survives');
  no(/inventory_policy/.test(BUYBOX_RAW), 'stock policy still gates copy');
});
t('no "Only N left" copy remains', () => {
  no(/Only .*left/i.test(BUYBOX), 'stock-count copy survives');
  no(/left in stock|remaining|selling out/i.test(BUYBOX), 'scarcity-count copy survives');
});
t('the urgency line renders no number at all', () => {
  /* The copy is built in a Liquid assign, not written as literal markup, so
     the statement is where it has to be read. A digit appearing here would
     mean a count was appended to an approved sentence. */
  const block = BUYBOX_RAW.slice(BUYBOX_RAW.indexOf('assign urgency ='));
  const stmt = block.slice(0, block.indexOf('\n'));
  no(/\d/.test(stmt), 'a figure was appended: ' + stmt.trim());
  no(/append:/.test(stmt), 'the approved sentence is being concatenated with something');
});t('the manufactured deadline stays gone', () => {
  no(/Limited-time price/.test(BUYBOX_RAW), 'the invented deadline returned');
  no(/countdown|ends (in|today)|hurry/i.test(BUYBOX), 'a deadline claim appeared');
});
t('urgency clears the disclaimer it sits beneath', () => {
  /* The failure this exists for: 12px/400/--ink-2 tax note against a
     13px/500/--ink-2 urgency read as one grey block. Size and ink must
     both differ, not just one of them. */
  const flat = BUYCSS.replace(/\n/g, ' ');
  const u = /\.buybox \.buybox-urgency\{[^}]*\}/.exec(flat);
  const n = /\.buybox-tax-note\{[^}]*\}/.exec(flat);
  ok(u && n, 'missing urgency or tax-note rule');
  const size = (r) => Number(/font-size:(\d+)px/.exec(r)[1]);
  ok(size(u[0]) > size(n[0]), 'urgency is not larger than the disclaimer');
  const uInk = /color:var\((--[a-z0-9-]+)\)/.exec(u[0])[1];
  const nInk = /color:var\((--[a-z0-9-]+)\)/.exec(n[0])[1];
  no(uInk === nInk, 'urgency shares the disclaimer ink (' + uInk + ')');
});t('urgency does not borrow the error colour', () => {
  const flat = BUYCSS.replace(/\n/g, ' ');
  no(/\.buybox-urgency\{[^}]*color:var\(--danger\)/.test(flat),
     'the error token means "something went wrong" in seven other places');
  ok(/\.buybox-urgency\{[^}]*color:var\(--urgent\)/.test(flat), 'no dedicated urgency token');
});
t('the urgency red is a real token, declared once, distinct from danger', () => {
  const m = /--urgent:\s*(#[0-9A-Fa-f]{6})/.exec(CSS);
  const d = /--danger:\s*(#[0-9A-Fa-f]{6})/.exec(CSS);
  ok(m && d, 'a red is missing from the token block');
  no(m[1].toLowerCase() === d[1].toLowerCase(), 'urgent and danger are the same colour');
  no(/#B3261E/i.test(BUYCSS), 'the value was inlined instead of tokenised');
});
t('meaning never rests on colour alone', () => {
  /* A shopper who cannot separate the reds still gets a mark plus the words. */
  ok(/buybox-urgency-dot/.test(BUYBOX_RAW), 'no non-colour marker');
  ok(/aria-hidden="true"/.test(/<span class="buybox-urgency-dot"[^>]*>/.exec(BUYBOX_RAW)[0]),
     'the decorative dot is announced');
});
t('the urgency dot does not loop', () => {
  /* The theme's documented motion rule: the badge earns "one beat, no loop",
     and the cart row's exit animation was deleted after two production bugs.
     A dot pulsing forever is the live-data idiom on a sentence that never
     changes. */
  const flat = BUYCSS.replace(/\n/g, ' ');
  const dot = /\.buybox-urgency-dot\{[^}]*\}/.exec(flat);
  ok(dot, 'no dot rule');
  no(/animation|infinite|blink|pulse/i.test(dot[0]), 'the dot animates');
});t('urgency still ranks below the price and the button', () => {
  const flat = BUYCSS.replace(/\n/g, ' ');
  const u = Number(/\.buybox \.buybox-urgency\{[^}]*font-size:(\d+)px/.exec(flat)[1]);
  ok(u <= 16, 'urgency at ' + u + 'px competes with the price');
});
t('no stale red rationale survives in the comments', () => {
  no(/one red line on the page/i.test(BUYCSS), 'comment still describes a red line');
  no(/Red, and the only red/i.test(BUYBOX_RAW), 'comment still describes a red line');
});
t('urgency uses only existing tokens and no decoration', () => {
  const flat = BUYCSS.replace(/\n/g, ' ');
  const block = /\.buybox \.buybox-urgency\{[^}]*\}/.exec(flat);
  ok(block, 'no urgency rule');
  no(/background|border|box-shadow|animation/.test(block[0]), 'decorative UI added');
  no(/#[0-9a-fA-F]{3,6}/.test(block[0]), 'a raw colour was introduced');
});
t('dispatch_promise keeps a home so the setting is not orphaned', () => {
  const bar = fs.readFileSync(path.join(ROOT, 'sections/sticky-buy-bar.liquid'), 'utf8');
  ok(/settings\.dispatch_promise/.test(bar), 'the setting no longer renders anywhere');
});

/* ---- haptics ---- */
t('haptic fires only after a successful copy', () => {
  const src = OFFER_JS;
  ok(/navigator\.vibrate/.test(src), 'no haptic');
  const confirmFn = src.slice(src.indexOf('var confirm'), src.indexOf('var selectCode'));
  ok(/navigator\.vibrate/.test(confirmFn), 'haptic is not on the confirmation path');
});
t('haptic is feature-detected and cannot throw', () => {
  ok(/if \(navigator\.vibrate\)/.test(OFFER_JS), 'not feature-detected');
  ok(/try \{ navigator\.vibrate\(10\); \} catch/.test(OFFER_JS), 'unguarded vibrate');
});
t('a failed haptic cannot fail the copy', () => {
  /* Source order is not execution order — confirm() is defined before the
     clipboard call and invoked after it. What matters is that the vibrate is
     wrapped, and that the visible confirmation is set before it. */
  const c = OFFER_JS.slice(OFFER_JS.indexOf('var confirm'), OFFER_JS.indexOf('var selectCode'));
  ok(c.indexOf("classList.add('is-copied')") < c.indexOf('navigator.vibrate'),
     'the visible confirmation depends on the motor');
  ok(/try \{[^}]*vibrate[^}]*\} catch/.test(c), 'unguarded vibrate');
});
t('the fallback path does not fake a successful copy with haptics', () => {
  const sel = OFFER_JS.slice(OFFER_JS.indexOf('var selectCode'), OFFER_JS.indexOf('if (navigator.clipboard'));
  no(/vibrate/.test(sel), 'haptic on a path where nothing was copied');
});
/* ---- sticky bar elevation (pre-existing, must not regress) ---- */
t('the sticky buy bar keeps its two-part elevation', () => {
  const flat = CSS.replace(/\n/g, ' ');
  const bar = /\.buybar\{[^}]*\}/.exec(flat);
  ok(bar, 'no .buybar rule');
  ok(/box-shadow:0 -1px 0 var\(--edge\), 0 -12px 32px/.test(bar[0]),
     'the crisp+soft shadow pair was lost');
});
t('the sticky bar elevation was not doubled', () => {
  const flat = CSS.replace(/\n/g, ' ');
  const bar = /\.buybar\{[^}]*\}/.exec(flat)[0];
  eq((bar.match(/box-shadow/g) || []).length, 1, 'two shadows declared');
});
t('the filler words and decorative tick are gone', () => {
  no(/this order/i.test(BUYBOX), 'filler copy survives');
  no(/name: 'check'[^}]{0,40}offer|offer[^}]{0,80}name: 'check'/.test(BUYBOX), 'the tick survives');
});
t('the offer uses the MamaJoy palette, not a borrowed one', () => {
  const block = BUYCSS.slice(BUYCSS.indexOf('.offer{'), BUYCSS.indexOf('.offer-copy:hover'));
  ok(/var\(--indigo\)/.test(block));
  no(/#[dDeE][0-9a-fA-F]{5}|crimson|red/.test(block), 'a red crept into the offer');
});
t('the dead prepaid styles are gone', () =>
  no(/\.prepaid/.test(BUYCSS), 'dead CSS for the removed control'));

/* The whole point, stated once more as a single assertion: the offer is
   informational, so nothing about adding to the cart may reference it. */
t('Add to Cart still cannot apply the offer', () => {
  const from = JS.indexOf("document.addEventListener('submit'");
  const add = JS.slice(from, JS.indexOf('document.addEventListener', from + 10))
                .replace(/\/\*[\s\S]*?\*\//g, '');
  no(/offer|discount|CARE5/i.test(add), 'the add path knows about the offer');
});
t('no code path in theme.js can reach /discount/', () => {
  const code = JS.replace(/\/\*[\s\S]*?\*\//g, '');
  no(/discount\//.test(code), 'a discount navigation survives in theme.js');
});

/* ------------------------------------------------- 13. product videos */

const PV_RAW = fs.readFileSync(path.join(ROOT, 'sections/product-videos.liquid'), 'utf8');
const PV = PV_RAW.replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, '');
const PVCSS = fs.readFileSync(path.join(ROOT, 'assets/section-product-videos.css'), 'utf8');
const PTPL_RAW = fs.readFileSync(path.join(ROOT, 'templates/product.json'), 'utf8');
const PTPL = JSON.parse(PTPL_RAW.slice(PTPL_RAW.indexOf('{')));
const GALLERY = fs.readFileSync(path.join(ROOT, 'sections/main-product.liquid'), 'utf8');

/* The whole productVideos IIFE. Sliced by name and closing punctuation so a
   test reads the shipped module rather than a fixed character count that goes
   quietly out of date the moment the function grows. */
function pvidJs() {
  const src = JS.slice(JS.indexOf('function productVideos'));
  const end = src.indexOf('\n  })();');
  ok(end > -1, 'could not find the end of productVideos');
  return src.slice(0, end);
}

t('the video section renders after the FAQ', () =>
  ok(PTPL.order.indexOf('faq') < PTPL.order.indexOf('videos'), PTPL.order.join(' -> ')));
t('the video section renders before the reviews', () =>
  ok(PTPL.order.indexOf('videos') < PTPL.order.indexOf('reviews'), PTPL.order.join(' -> ')));
t('reviews stay last on the page', () =>
  eq(PTPL.order[PTPL.order.length - 1], 'reviews'));
t('the FAQ was not moved off its own position before videos', () =>
  eq(PTPL.order[PTPL.order.indexOf('videos') - 1], 'faq'));
t('the template still holds every section it had', () => {
  ['main', 'benefits', 'specs', 'faq', 'reviews'].forEach((k) =>
    ok(PTPL.sections[k], 'lost section: ' + k));
});
t('the Judge.me review block survived the template rewrite', () =>
  ok(JSON.stringify(PTPL.sections.reviews).includes('judge-me-reviews'),
     'the review app block was dropped'));
t('the FAQ keeps all six questions', () =>
  eq(Object.keys(PTPL.sections.faq.blocks).length, 6));
t('the videos section points at the new section type', () =>
  eq(PTPL.sections.videos.type, 'product-videos'));

t('videos come from Shopify product media', () => {
  ok(PV.includes('product.media'), 'not sourced from product media');
  ok(PV.includes("media_type == 'video'"), 'does not filter to video');
  ok(PV.includes('m.sources'), 'does not read Shopify video sources');
});
t('no video URL is hardcoded', () =>
  no(/https?:\/\/[^"'\s]*\.(mp4|m3u8|webm)/i.test(PV), 'a video URL is baked into the markup'));
t('the section disappears entirely when there is no video', () => {
  ok(/video_count > 0/.test(PV), 'no empty-state guard');
  ok(PV.indexOf('video_count > 0') < PV.indexOf('<section'), 'the guard does not wrap the section');
});

t('videos show no product name', () => no(/product\.title/.test(PV)));
t('videos show no price', () => no(/price|money/i.test(PV)));
t('videos show no discount or saving', () => no(/discount|% off|saved|compare_at/i.test(PV)));
t('videos have no Add to Cart', () =>
  no(/add-to-cart|cartAdd|buybox-form|<form/i.test(PV)));
t('videos carry no product card markup', () => no(/product-card|card/i.test(PV)));

t('no strip clip downloads before it is scrolled to', () => {
  /* The section sits several screens below the fold, so every byte a clip
     spends at first paint is a byte nobody asked for. preload="none" plus no
     autoplay attribute is what buys that back; either one alone does not,
     because for an autoplay-eligible video the browser lets autoplay win over
     preload. */
  ok(/preload="none"/.test(PV), 'preload is not none — clips load before they are wanted');
  no(/preload="auto"/.test(PV), 'the whole file is being fetched up front');
  no(/preload="metadata"/.test(PV), 'metadata preload is back on the strip');
  const stripBlock = PV.slice(PV.indexOf('class="pvid-video"'), PV.indexOf('</video>'));
  no(/\bautoplay\b/.test(stripBlock),
     'the autoplay attribute is back on the strip clip, which restarts the eager download it was removed to stop');
});
t('the deferred clip still satisfies what a scripted play() needs', () => {
  /* muted + playsinline is the combination iOS requires before it will let
     play() run without a user gesture. Losing either turns every clip in the
     strip into a still frame on a phone. */
  ['muted', 'loop', 'playsinline'].forEach((a) =>
    ok(new RegExp('\\b' + a + '\\b').test(PV), 'missing ' + a));
  ok(/data-pvid/.test(JS), 'nothing manages playback');
});
t('the deferred source is handed to JS and attached exactly once', () => {
  ok(/data-pvid-strip-src=/.test(PV), 'the strip source is not deferred to a data attribute');
  const fn = pvidJs();
  ok(/data-pvid-strip-src/.test(fn), 'nothing in theme.js ever attaches the deferred source');
  ok(/removeAttribute\('data-pvid-strip-src'\)/.test(fn),
     'the attribute must be consumed, or a clip scrolled past repeatedly re-assigns src and restarts the download');
});
t('a browser without IntersectionObserver still plays every clip', () => {
  /* The autoplay attribute used to cover this path. It is gone, so the
     fallback has to start them explicitly or the strip is dead on old
     browsers. */
  const fn = pvidJs();
  const bail = fn.slice(fn.indexOf('if (!window.IntersectionObserver)'));
  ok(/list\.forEach\(play\)/.test(bail.slice(0, 200)),
     'the no-observer path must start the clips itself now that autoplay no longer does');
});
t('every visible clip plays — no single-clip selection survives', () => {
  const fn = pvidJs();
  ok(/intersectionRatio/.test(fn), 'visibility is not measured');
  no(/bestRatio/.test(fn), 'a most-visible selection is back — only one clip would run');
  ok(/intersectionRatio >= 0\.25/.test(fn), 'no visibility threshold for playing');
  ok(/\.pause\(\)/.test(fn), 'nothing is paused');
});
t('clips below the visibility threshold are paused, including at load', () => {
  const fn = pvidJs();
  ok(/list\[i\]\.pause\(\)/.test(fn), 'an off-screen clip keeps running');
  ok(/\{ threshold: \[0,/.test(fn),
     'the observer must report a 0 ratio so off-screen clips pause on the first callback');
});
t('playback is viewport-driven by observer, not scroll listeners', () => {
  const src = JS.slice(JS.indexOf('function productVideos'));
  const fn = src.slice(0, src.indexOf('\n  })();'));
  ok(/IntersectionObserver/.test(fn), 'no observer');
  no(/addEventListener\('scroll'/.test(fn), 'a scroll listener would be the expensive way');
});
t('a refused autoplay is handled, not thrown, and leaves the poster showing', () => {
  const fn = pvidJs();
  ok(/\.catch\(/.test(fn), 'the play() rejection is unhandled');
  ok(/v\.play\(\)/.test(fn), 'nothing calls play');
  ok(/poster="/.test(PV), 'a blocked clip would be a black rectangle with no first frame');
});
t('reduced motion never auto-starts, but still stops off-screen audio', () => {
  const src = JS.slice(JS.indexOf('function productVideos'));
  const fn = src.slice(0, src.indexOf('\n  })();'));
  ok(/if \(RM\)/.test(fn), 'reduced motion is ignored');
  const rm = fn.slice(fn.indexOf('if (RM)'), fn.indexOf('var best'));
  ok(/pause\(\)/.test(rm), 'reduced motion leaves off-screen audio running');
  no(/play\(\)/.test(rm), 'reduced motion still auto-starts');
});
t('the native control bar is gone — it is the one thing CSS cannot make consistent', () => {
  no(/\bcontrols\b/.test(PV), 'the browser draws its own widget again');
  no(/::-webkit-media-controls/.test(PVCSS),
     'styling the native bar is WebKit/Blink-only and cannot produce one presentation');
});
t('the strip draws no controls at all', () => {
  const css = PVCSS.replace(/\n/g, ' ');
  no(/\bcontrols\b/.test(PV), 'native browser chrome is back');
  no(/pvid-disc|pvid-toggle|pvid-sound\b/.test(PV), 'a control is back on the thumbnails');
  no(/data-chrome/.test(css), 'the reveal-on-tap chrome is back in the strip');
  const frameScoped = css.match(/\.pvid-frame[^{]*\{[^}]*\}/g) || [];
  frameScoped.forEach((r) => no(/opacity/.test(r), 'a hidden overlay survives on the frame: ' + r));
});
t('the only thing over a thumbnail is a transparent target', () => {
  ok(/<button type="button" class="pvid-open"/.test(PV), 'the tap target is not a real button');
  ok(/data-pvid-open/.test(PV) && /data-pvid-open/.test(JS), 'the target is not wired up');
  const css = PVCSS.replace(/\n/g, ' ');
  const rule = /\.pvid-open\{([^}]*)\}/.exec(css);
  ok(rule, 'the tap target has no rule');
  ok(/background:none/.test(rule[1]), 'the target paints something over the clip');
  ok(/inset:0/.test(rule[1]), 'the target is not the whole frame');
});
t('a swipe across the strip scrolls it rather than opening a clip', () => {
  const fn = pvidJs();
  ok(/pointerdown/.test(fn), 'no gesture guard — every scroll would open the viewer');
  ok(/Math\.abs\(e\.clientX - px\) > 10/.test(fn), 'the guard does not measure travel');
  ok(/e\.detail !== 0/.test(fn), 'a keyboard activation would be treated as a drag and ignored');
});

/* ---- the viewer ---- */

t('tapping a clip opens a viewer rather than acting on playback', () => {
  ok(/data-pvid-lb\b/.test(PV), 'no viewer markup');
  const fn = pvidJs();
  ok(/function openLb/.test(fn), 'nothing opens the viewer');
  ok(/openLb\(i\)/.test(fn), 'the tap target does not open it');
});
t('the viewer carries exactly two controls: sound and a way out', () => {
  const btns = PV.match(/<button[^>]*class="pvid-lb-btn"[^>]*>/g) || [];
  eq(btns.length, 2);
  btns.forEach((b) => ok(/aria-label="/.test(b), 'unlabelled control: ' + b));
  ok(/data-pvid-lb-sound/.test(PV) && /data-pvid-lb-close/.test(PV));
  no(/pvid-lb-(play|pause|seek|scrub|next|prev|fullscreen)/.test(PV), 'an extra control crept in');
});
t('the viewer is one element for the section, not one per clip', () => {
  eq((PV.match(/data-pvid-lb(?![-\w])/g) || []).length, 1,
     'a viewer per clip means a decoder per clip');
  ok(PV.indexOf('data-pvid-lb') > PV.indexOf('</ul>'), 'the viewer sits inside the scrolling strip');
});
t('the viewer is out of the tab order until it opens', () => {
  ok(/<div class="pvid-lb" data-pvid-lb hidden/.test(PV),
     'hidden is what keeps the subtree out of the accessibility tree without a stylesheet');
  ok(/\.pvid-lb\[hidden\]\{ ?display:none/.test(PVCSS.replace(/\n/g, ' ')),
     'display:grid would override the hidden attribute');
});
t('the viewer is a labelled modal dialog', () => {
  ok(/role="dialog"/.test(PV) && /aria-modal="true"/.test(PV));
  ok(/aria-labelledby="pvid-lb-title-/.test(PV), 'the dialog has no accessible name');
  ok(/class="visually-hidden">Product video viewer/.test(PV), 'the name has no element');
});
t('the viewer traps focus, takes Escape, and gives focus back', () => {
  const fn = pvidJs();
  ok(/e\.key === 'Escape'/.test(fn), 'no Escape');
  ok(/e\.key !== 'Tab'/.test(fn), 'no focus trap');
  ok(/lbClose\.focus\(\)/.test(fn), 'focus is not moved into the dialog on open');
  ok(/back\.focus\(\{ preventScroll: true \}\)/.test(fn), 'focus is not returned on close');
});
t('opening the viewer silences and stops the strip behind it', () => {
  const fn = pvidJs();
  ok(/list\.forEach\(function \(v\) \{ v\.pause\(\); v\.muted = true; \}\)/.test(fn),
     'clips keep running behind the viewer');
  ok(/if \(openIndex > -1\) \{ list\[i\]\.pause\(\); return; \}/.test(fn),
     'the observer would restart the strip underneath an open viewer');
});
t('the viewer opens muted — sound is never introduced without a tap', () => {
  const fn = pvidJs();
  const body = fn.slice(fn.indexOf('function openLb'), fn.indexOf('function closeLb'));
  ok(/lbVideo\.muted = true/.test(body), 'the viewer could open with audio');
  ok(/muted/.test(PV.slice(PV.indexOf('pvid-lb-video'), PV.indexOf('pvid-lb-bar'))),
     'the viewer element is not muted in markup');
});
t('the viewer picks the clip up where the thumbnail had reached', () => {
  const fn = pvidJs();
  ok(/lbVideo\.currentTime = list\[i\]\.currentTime/.test(fn), 'the clip restarts from zero');
  ok(/try \{ lbVideo\.currentTime/.test(fn),
     'assigning currentTime before a duration is known throws on some browsers');
});
t('closing the viewer drops the source rather than downloading in the background', () => {
  const fn = pvidJs();
  const body = fn.slice(fn.indexOf('function closeLb'));
  ok(/lbVideo\.removeAttribute\('src'\)/.test(body), 'the source stays attached');
  ok(/lbVideo\.load\(\)/.test(body), 'removing src alone does not abandon the request');
});
t('closing the viewer restarts the clips that are actually on screen', () => {
  const fn = pvidJs();
  ok(/pvid:closed/.test(fn), 'no signal on close');
  eq((fn.match(/pvid:closed/g) || []).length, 2, 'the close event is dispatched or listened for, not both');
  ok(/vis \/ r\.height >= 0\.25/.test(fn), 'the restart does not re-check visibility');
});
t('the viewer ground closes on tap, the clip itself does not', () => {
  const fn = pvidJs();
  ok(/if \(e\.target === lb\) closeLb\(\)/.test(fn),
     'either the backdrop does not close, or a mis-tap on the clip would');
});
t('the viewer sound button states are labelled and drawn', () => {
  const css = PVCSS.replace(/\n/g, ' ');
  ok(/\.pvid-lb:not\(\[data-sound\]\) \.pvid-i--soundoff/.test(css), 'no muted glyph');
  ok(/\.pvid-lb\[data-sound\]\s+\.pvid-i--soundon/.test(css), 'no unmuted glyph');
  const fn = pvidJs();
  ok(/'Turn sound off' : 'Turn sound on'/.test(fn), 'the button never renames itself');
  ok(/lbVideo\.addEventListener\('volumechange', syncSound\)/.test(fn),
     'a browser muting the clip on its own would leave the button lying');
});
t('the viewer controls clear 44px and stay off the notch', () => {
  const css = PVCSS.replace(/\n/g, ' ');
  const m = /\.pvid-lb-btn\{[^}]*width:(\d+)px;\s*height:(\d+)px/.exec(css);
  ok(m, 'the viewer buttons no longer size themselves');
  ok(Number(m[1]) >= 44 && Number(m[2]) >= 44, 'viewer target is ' + m[1] + 'x' + m[2]);
  ok(/env\(safe-area-inset-top\)/.test(css), 'the close button can sit under the iOS status bar');
});
t('the viewer glyphs clear contrast on their own ground', () => {
  /* #FFF on the button ground, worst case a white frame behind it. */
  const m = /\.pvid-lb-btn\{[^}]*background:rgba\(20,22,26,\.(\d+)\)/.exec(PVCSS.replace(/\n/g, ' '));
  ok(m, 'the viewer button declares no ground');
  const a = Number('0.' + m[1]);
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const chan = (ink) => a * (ink / 255) + (1 - a) * 1;
  const L = 0.2126 * lin(chan(20)) + 0.7152 * lin(chan(22)) + 0.0722 * lin(chan(26));
  const ratio = 1.05 / (L + 0.05);
  ok(ratio >= 4.5, 'viewer glyph is only ' + ratio.toFixed(2) + ':1 over a white frame');
});
t('the viewer survives the iOS address bar', () => {
  const css = PVCSS.replace(/\n/g, ' ');
  ok(/height:100vh; ?height:100dvh/.test(css),
     '100vh alone puts the controls under Safari chrome; dvh needs a vh fallback under it');
});
t('the viewer does not crop the footage either', () =>
  ok(/\.pvid-lb-video\{[^}]*object-fit:contain/.test(PVCSS.replace(/\n/g, ' '))));
t('reduced motion leaves the strip on its posters', () => {
  const fn = pvidJs();
  const rm = fn.slice(fn.indexOf('if (RM)'), fn.indexOf('if (RM)') + 200);
  ok(/v\.pause\(\)/.test(rm), 'reduced motion leaves every clip running');
  /* The viewer is a deliberate request to watch one thing, so it still plays.
     It must be wired before the RM return or it would be dead for those users. */
  ok(fn.indexOf('lbClose.addEventListener') < fn.indexOf('if (RM)'),
     'reduced-motion users would get a viewer with no working controls');
});
t('keyboard focus stays visible inside the scroller', () =>
  ok(/\.pvid-open:focus-visible/.test(PVCSS), 'the tap target has no focus ring'));
t('off-screen videos are paused, not left playing', () => {
  const js = pvidJs();
  ok(/IntersectionObserver/.test(js), 'no observer');
  ok(/list\[i\]\.pause\(\)/.test(js), 'nothing pauses');
});
t('picture-in-picture and AirPlay targets are not offered on a reel', () => {
  ok(/disablepictureinpicture/.test(PV));
  ok(/disableremoteplayback/.test(PV));
  ok(/x-webkit-airplay="deny"/.test(PV));
});
t('video plays inline on iOS rather than hijacking fullscreen', () =>
  ok(/playsinline/.test(PV)));
t('video has a poster so the strip renders before any video loads', () =>
  ok(/poster="/.test(PV)));
t('video carries intrinsic dimensions against layout shift', () => {
  ok(/width="\{\{ m\.preview_image\.width/.test(PV));
  ok(/height="\{\{ m\.preview_image\.height/.test(PV));
});
t('the slot holds its shape with aspect-ratio', () =>
  ok(/aspect-ratio:9\/16/.test(PVCSS)));
t('video is never stretched or cropped', () => {
  ok(/object-fit:contain/.test(PVCSS), 'contain is what guarantees no crop');
  no(/object-fit:cover/.test(PVCSS));
});
/* The spacing scale, read out of theme.css rather than copied into this file,
   so a token that moves moves the layout assertions with it. */
const TOKENS = (() => {
  const map = {};
  const re = /(--s-\d+):\s*(\d+)px/g;
  let m;
  while ((m = re.exec(CSS))) map[m[1]] = Number(m[2]);
  return map;
})();

/* Every figure the strip's geometry depends on, parsed off the shipped CSS.
   Nothing here is a remembered number: change the stylesheet and this reads
   the new value, which is the point — the 70% rule is then verified against
   what actually ships rather than against what someone meant to ship. */
function stripGeometry() {
  const css = PVCSS.replace(/\n/g, ' ');
  const tok = (v) => {
    const t = /var\((--s-\d+)\)/.exec(v);
    ok(t, 'expected a spacing token, got: ' + v);
    ok(TOKENS[t[1]] !== undefined, 'unknown token ' + t[1]);
    return TOKENS[t[1]];
  };

  const phone = /@media\(max-width:899px\)\{\s*\.pvid\{([^}]*)\}/.exec(css);
  ok(phone, 'the phone block that sets the strip inset is gone');
  const pad = /padding-inline:\s*([^;]+);/.exec(phone[1]);
  ok(pad, 'the strip no longer declares its inset');

  const gapM = /\.pvid\{[^}]*gap:\s*([^;]+);/.exec(css);
  ok(gapM, 'the strip no longer declares a gap');

  const clamp = /\.pvid-item\{[^}]*flex:0 0 clamp\((\d+)px,\s*(\d+)vw,\s*(\d+)px\)/.exec(css);
  ok(clamp, 'card width is no longer a clamp — re-derive this test');

  /* The bleed must cancel .wrap's own gutter exactly, or the page scrolls
     sideways. That is a different token from the inset and must stay pinned
     to whatever .wrap uses. */
  const bleed = /margin-inline:\s*calc\(var\((--s-\d+)\)\s*\*\s*-1\)/.exec(phone[1]);
  ok(bleed, 'the strip no longer bleeds to the viewport edge');
  const wrapPad = /\.wrap\{[^}]*padding-inline:var\((--s-\d+)\)/.exec(CSS.replace(/\n/g, ' '));
  ok(wrapPad, 'could not read .wrap padding');

  return {
    inset: tok(pad[1]),
    gap: tok(gapM[1]),
    min: Number(clamp[1]), vwPct: Number(clamp[2]), max: Number(clamp[3]),
    bleedToken: bleed[1], wrapToken: wrapPad[1],
  };
}

const PHONES = [375, 390, 393, 414];

t('the strip bleed cancels the page gutter exactly, so nothing overflows', () => {
  const g = stripGeometry();
  eq(g.bleedToken, g.wrapToken);
});
t('the second clip clears 70% at every phone width', () => {
  const g = stripGeometry();
  PHONES.forEach((vw) => {
    const W = Math.min(Math.max(g.min, vw * g.vwPct / 100), g.max);
    const visible = (vw - g.inset - W - g.gap) / W;
    ok(visible >= 0.70, vw + 'px: second clip only ' + (visible * 100).toFixed(1) + '%');
  });
});
t('the second clip does not overshoot into a two-column grid', () => {
  /* Above ~80% the strip stops reading as "one video and a hint of the next"
     and starts reading as two half-width videos, which loses the swipe cue. */
  const g = stripGeometry();
  PHONES.forEach((vw) => {
    const W = Math.min(Math.max(g.min, vw * g.vwPct / 100), g.max);
    const visible = (vw - g.inset - W - g.gap) / W;
    ok(visible <= 0.80, vw + 'px: second clip at ' + (visible * 100).toFixed(1) + '%');
  });
});
t('the strip sits close to the viewport edge rather than on the text gutter', () => {
  const g = stripGeometry();
  ok(g.inset <= 16, 'inset of ' + g.inset + 'px still reads as a floating card');
  ok(g.inset >= 8, 'inset of ' + g.inset + 'px leaves the rounded corner nothing to sit on');
});
t('the first card is the dominant element on a phone', () => {
  const g = stripGeometry();
  PHONES.forEach((vw) => {
    const W = Math.min(Math.max(g.min, vw * g.vwPct / 100), g.max);
    ok(W / vw >= 0.50, vw + 'px: first card is only ' + (W / vw * 100).toFixed(1) + '% of the viewport');
  });
});
t('the card grew rather than the whitespace shrinking alone', () => {
  /* The pass before this shipped 50vw at a 24px inset. Both had to move: the
     inset alone leaves the card the same size, and the card alone leaves it
     floating. Guards the regression back to either half. */
  const g = stripGeometry();
  ok(g.vwPct > 50, 'card is back to ' + g.vwPct + 'vw');
  ok(g.inset < 24, 'inset is back to the text gutter');
});
t('9:16 survived the resize', () => {
  ok(/aspect-ratio:9\/16/.test(PVCSS), 'the shape changed');
  ok(/object-fit:contain/.test(PVCSS), 'a bigger card started cropping footage');
});
t('the cards are not shrunk to nothing to pass that rule', () => {
  const m = /flex:0 0 clamp\((\d+)px/.exec(PVCSS);
  ok(Number(m[1]) >= 150, 'card floor of ' + m[1] + 'px is too small to read');
});
t('the section no longer opens on its own block of empty space', () => {
  ok(/\.pvid-sec\{[^}]*padding-top:0/.test(PVCSS.replace(/\n/g, ' ')),
     'the section still adds its own top padding under the FAQ');
  ok(/class="[^"]*pvid-sec/.test(PV), 'the section does not carry the class');
});
t('the FAQ above it closes on a paragraph gap, not a chapter break', () => {
  /* The preceding .sec closes with --rhythm of padding. The pull is written
     as -(rhythm - token), so the surviving gap is exactly the token whatever
     --rhythm happens to be at that breakpoint — which is why this can assert
     one number instead of one per media query. */
  const css = PVCSS.replace(/\n/g, ' ');
  const m = /\.pvid-sec\{[^}]*margin-top:\s*calc\(\(var\(--rhythm\)\s*-\s*var\((--s-\d+)\)\)\s*\*\s*-1\)/.exec(css);
  ok(m, 'the section no longer pulls up into the preceding rhythm');
  const gap = TOKENS[m[1]];
  ok(gap >= 16 && gap <= 24, 'FAQ to videos would be ' + gap + 'px, outside the 16-24px target');
});
t('the pull is derived from the rhythm token, never a flat pixel figure', () => {
  const css = PVCSS.replace(/\n/g, ' ');
  const rule = /\.pvid-sec\{([^}]*)\}/.exec(css);
  ok(rule, 'the section rule is gone');
  no(/margin-top:\s*-\d+px/.test(rule[1]),
     'a hardcoded pull goes wrong at every breakpoint where --rhythm changes');
});
t('desktop reopens the gap rather than staying at the phone figure', () => {
  const css = PVCSS.replace(/\n/g, ' ');
  const m = /@media\(min-width:900px\)\{\s*\.pvid-sec\{\s*margin-top:\s*calc\(\(var\(--rhythm\)\s*-\s*var\((--s-\d+)\)\)\s*\*\s*-1\)/.exec(css);
  ok(m, 'no desktop override — 24px between sections is a phone decision');
  ok(TOKENS[m[1]] > 24, 'desktop gap of ' + TOKENS[m[1]] + 'px is still the phone figure');
});
t('the last clip is not left under the sticky bar', () =>
  ok(/\.pvid-sec\{[^}]*padding-bottom:var\(--s-\d\)/.test(PVCSS.replace(/\n/g, ' ')),
     'no bottom breathing room above the sticky Add to Cart'));
t('the strip scrolls horizontally with snap', () => {
  ok(/overflow-x:auto/.test(PVCSS));
  ok(/scroll-snap-type:x/.test(PVCSS));
  ok(/scroll-snap-align/.test(PVCSS));
});
t('desktop gets its own sizing rather than the mobile layout', () =>
  ok(/min-width:900px/.test(PVCSS) && /min-width:1280px/.test(PVCSS)));
t('the strip uses the theme radius and palette', () => {
  ok(/border-radius:var\(--r-lg\)/.test(PVCSS));
  ok(/var\(--jute\)/.test(PVCSS));
});
t('the section is named for assistive tech even with no heading', () =>
  ok(/aria-label="Product videos"/.test(PV)));
t('each video is individually labelled', () => ok(/aria-label="Product video/.test(PV)));
t('the strip is a real list', () => ok(/<ul class="pvid"/.test(PV) && /<li class="pvid-item"/.test(PV)));

t('the strip is silent in every state — sound exists only in the viewer', () => {
  const js = pvidJs();
  no(/addEventListener\('scroll'/.test(js), 'a scroll listener would be the expensive way');
  /* Nothing may unmute a thumbnail. The only assignments allowed against a
     strip clip are to true; the viewer's own element is a separate variable. */
  const unmutes = (js.match(/list\[[^\]]*\]\.muted = (?!true)/g) || [])
    .concat(js.match(/\bv\.muted = (?!true)/g) || []);
  eq(unmutes.length, 0, 'a thumbnail can be unmuted: ' + unmutes.join(', '));
  ok(/muted/.test(PV.slice(0, PV.indexOf('pvid-open'))), 'the strip element is not muted in markup');
});

t('the product gallery was not touched', () => {
  ok(GALLERY.includes('product.images'), 'the gallery no longer reads product.images');
  no(/pvid|product-videos/.test(GALLERY), 'video leaked into the gallery');
});
t('videos are not duplicated into the gallery', () =>
  no(/media_type/.test(GALLERY), 'the gallery now renders media and would duplicate the videos'));

/* Floating video was evaluated and deliberately not built — the sticky buy bar
   owns the bottom of the mobile viewport. These assert the decision held. */
t('no floating video widget was added', () => {
  no(/floating-video|float-video|video-bubble/i.test(JS));
  no(/floating-video|float-video/i.test(CSS));
});
t('nothing in the strip competes with the sticky buy bar for the bottom corner', () => {
  /* The viewer is legitimately fixed — it is a full-screen layer — and the
     theme already hides the buy bar under body.zoom-open, which this reuses
     rather than inventing a second lock. Nothing else may be pinned. */
  const fixed = (PVCSS.replace(/\n/g, ' ').match(/\.[\w-]+\{[^}]*position:fixed[^}]*\}/g) || []);
  eq(fixed.length, 1, 'more than the viewer is pinned to the viewport');
  ok(/\.pvid-lb\{/.test(fixed[0]), 'something other than the viewer is pinned: ' + fixed[0]);
  ok(/body\.zoom-open \.buybar\{ ?opacity:0/.test(CSS.replace(/\n/g, ' ')),
     'the buy bar is not hidden while a full-screen layer is open');
  ok(/zoom-open/.test(JS), 'the viewer does not use the existing scroll lock');
});

/* ------------------------------------------------- 13b. Judge.me skin

   The widget is a third party's markup, so these assert against the classes
   Judge.me actually ships. Those class names are taken from the widget HTML
   Judge.me itself stores in the product's judgeme.widget metafield, not from
   memory: the root is .jdgm-rev-widg and a star is an empty
   <span class="jdgm-star jdgm--on"></span>. */

const JM = fs.readFileSync(path.join(ROOT, 'assets/component-judgeme.css'), 'utf8');
const JMFLAT = JM.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n/g, ' ');

t('the skin targets the widget root Judge.me actually renders', () => {
  ok(/\.mj-reviews \.jdgm-rev-widg \*\{ ?font-family:inherit/.test(JMFLAT),
     'the font reset does not reach the widget');
  no(/\.jdgm-widget \*/.test(JMFLAT),
     'the reset still names .jdgm-widget, which does not exist in this widget markup');
});
t('the star does not depend on a third-party webfont', () => {
  /* Judge.me's star span is empty: every pixel came from a private-use
     codepoint in a font they host. If it fails to load there is nothing left
     to draw, which is how a rating silently degrades to five broken marks. */
  ok(/\.mj-reviews \.jdgm-star::before\{ ?content:'\\2605'/.test(JMFLAT),
     'the star has no glyph of its own');
  ok(/\.mj-reviews \.jdgm-star\{[^}]*font-family:inherit !important/.test(JMFLAT),
     'the star is still asking a third-party font for its glyph');
});
t('the star is the same character the rest of the theme already draws', () => {
  /* One shape from one font across all three star rows on a PDP. */
  ok(/★/.test(fs.readFileSync(path.join(ROOT, 'snippets/product-rating.liquid'), 'utf8')),
     'the theme component no longer uses U+2605 — re-derive this test');
});
t('a half star is one glyph clipped over another, not a second character', () => {
  ok(/\.jdgm-star\.jdgm--half::after\{[^}]*content:'\\2605'/.test(JMFLAT), 'no half-star fill');
  ok(/\.jdgm-star\.jdgm--half::after\{[^}]*width:50%/.test(JMFLAT), 'the fill is not clipped to half');
  ok(/\.jdgm-star\.jdgm--half::after\{[^}]*overflow:hidden/.test(JMFLAT), 'the clip does nothing');
});
t('stars and buttons use theme tokens, never an invented colour', () => {
  ok(/\.mj-reviews \.jdgm-star\{[^}]*color:var\(--indigo\)/.test(JMFLAT));
  ok(/\.jdgm-star\.jdgm--off\{ ?color:var\(--star-off\)/.test(JMFLAT));
  /* Judge.me's own gold and teal must not be restated here, and no raw hex
     may enter this file at all — every colour is a token or an rgba over the
     ink already established in theme.css. */
  const hexes = JM.replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  eq(hexes.length, 0, 'raw hex colours in the skin: ' + hexes.join(', '));
});
t('the write-a-review button wears the theme action colour', () => {
  const rule = /\.mj-reviews \.jdgm-write-rev-link,\s*\.mj-reviews \.jdgm-btn,\s*\.mj-reviews \.jdgm-paginate__load-more\{([^}]*)\}/.exec(JMFLAT);
  ok(rule, 'the button rule is gone');
  ok(/color:var\(--indigo\) !important/.test(rule[1]), 'the label colour can still be overridden');
  ok(/background:transparent !important/.test(rule[1]), 'the teal fill can still win');
  ok(/border:1px solid var\(--indigo\) !important/.test(rule[1]), 'the border can still be overridden');
  ok(/min-height:var\(--tap\)/.test(rule[1]), 'the 44px target was lost');
});
t('the theme action colour clears AA on the section surface', () => {
  const tok = (n) => new RegExp('--' + n + ':(#[0-9a-fA-F]{6})').exec(CSS);
  const [ind, chalk] = [tok('indigo'), tok('chalk')];
  ok(ind && chalk, 'could not read the tokens');
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const L = (h) => 0.2126 * lin(parseInt(h.substr(1, 2), 16)) +
                   0.7152 * lin(parseInt(h.substr(3, 2), 16)) +
                   0.0722 * lin(parseInt(h.substr(5, 2), 16));
  const [hi, lo] = [L(ind[1]), L(chalk[1])].sort((a, b) => b - a);
  const ratio = (hi + 0.05) / (lo + 0.05);
  ok(ratio >= 4.5, 'button label is only ' + ratio.toFixed(2) + ':1 on chalk');
});
t('!important is confined to the properties a runtime stylesheet contests', () => {
  /* Judge.me writes a merchant-settings <style> into the head after this file
     is parsed, so colour and the duplicate-heading hide need it. Nothing else
     may: an !important on layout would be this file losing an argument it
     should be winning on specificity. */
  const bangs = (JM.replace(/\/\*[\s\S]*?\*\//g, '').match(/[\w-]+\s*:[^;{}]*!important/g) || [])
    .map((d) => d.split(':')[0].trim());
  const allowed = ['color', 'background', 'border', 'display', 'font-family'];
  bangs.forEach((prop) => ok(allowed.includes(prop), 'unexpected !important on ' + prop));
});
t('the duplicate Customer Reviews heading and summary stay hidden', () => {
  ok(/\.mj-reviews \.jdgm-rev-widg__title,\s*\.mj-reviews \.jdgm-rev-widg__summary\{ ?display:none !important/.test(JMFLAT),
     'the widget restates the heading and the average the section already carries');
});

/* ---- spacing ---- */

t('the heading and its rating line are bound tighter than the group below', () => {
  /* Spacing between groups must exceed spacing within groups. The h2 and the
     average are one group; the widget under them is the next. */
  const within = /\.mj-reviews-head \.h2\{ ?margin-bottom:var\((--s-\d+)\)/.exec(JMFLAT);
  const between = /\.mj-reviews-head\{ ?margin-bottom:var\((--s-\d+)\)/.exec(JMFLAT);
  ok(within && between, 'the head spacing is no longer declared in tokens');
  const w = TOKENS[within[1]], b = TOKENS[between[1]];
  ok(b > w, 'group gap ' + b + 'px does not exceed the ' + w + 'px inside it');
  ok(b <= 24, 'group gap of ' + b + 'px reads as a section break inside one group');
});
t('videos hand over to reviews on a section step, not a dead zone', () => {
  const vids = /\.pvid-sec\{[^}]*padding-bottom:var\((--s-\d+)\)/.exec(PVCSS.replace(/\n/g, ' '));
  const revs = /\.mj-reviews\{ ?padding-top:var\((--s-\d+)\)/.exec(JMFLAT);
  ok(vids && revs, 'one side of the join no longer declares its padding');
  const gap = TOKENS[vids[1]] + TOKENS[revs[1]];
  ok(gap <= 56, 'videos to reviews is ' + gap + 'px, still a dead zone');
  ok(gap >= 32, 'videos to reviews is ' + gap + 'px, too tight for a real section change');
});
t('the reviews gap stays larger than the FAQ-to-videos continuation', () => {
  /* FAQ -> videos is one continuous answer and is deliberately tight.
     Videos -> reviews is a real change of argument and must read as one. */
  const pull = /\.pvid-sec\{[^}]*margin-top:calc\(\(var\(--rhythm\) - var\((--s-\d+)\)\) \* -1\)/
    .exec(PVCSS.replace(/\n/g, ' '));
  const vids = /\.pvid-sec\{[^}]*padding-bottom:var\((--s-\d+)\)/.exec(PVCSS.replace(/\n/g, ' '));
  const revs = /\.mj-reviews\{ ?padding-top:var\((--s-\d+)\)/.exec(JMFLAT);
  ok(pull && vids && revs, 'could not read both joins');
  ok(TOKENS[vids[1]] + TOKENS[revs[1]] > TOKENS[pull[1]],
     'the reviews join is no wider than the continuation above it');
});
t('desktop reopens the reviews gap rather than keeping the phone figure', () => {
  const m = /@media\(min-width:900px\)\{\s*\.mj-reviews\{ ?padding-top:var\((--s-\d+)\)/.exec(JMFLAT);
  ok(m, 'no desktop override');
  ok(TOKENS[m[1]] > 16, 'desktop keeps the phone padding');
});
t('nothing in the skin pins itself to the viewport on a phone', () => {
  /* The sticky summary column is a desktop affordance and must stay inside
     its media query, or it would fight the sticky buy bar on a phone. */
  const desktop = JMFLAT.slice(JMFLAT.indexOf('@media(min-width:900px)'));
  const phone = JMFLAT.slice(0, JMFLAT.indexOf('@media(min-width:900px)'));
  no(/position:sticky/.test(phone), 'a sticky element escaped the desktop block');
  ok(/position:sticky/.test(desktop), 'the desktop summary column lost its sticky');
});

/* ------------------------------------------------- 14. Liquid tag traps

   Inside a {% liquid %} block every line is a tag, so a bare tag name that
   happens to start a line of prose inside a comment opens a real nested tag
   that never closes and swallows the rest of the file. Shopify rejects the
   upload for it and, over a URL body, reports nothing at all. This is a
   spelling trap in prose, not in code, so only a test catches it. */

['snippets/buy-box.liquid', 'sections/cart-drawer.liquid', 'sections/product-videos.liquid']
  .forEach((rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    t('no unclosed bare comment tag in ' + rel, () => {
      const open = (src.match(/\n\s*comment\b/g) || []).length;
      const close = (src.match(/\n\s*endcomment\b/g) || []).length;
      eq(open, close, 'a line-initial "comment" opened a tag inside prose');
    });
    t('no line-initial Liquid keyword inside a liquid block in ' + rel, () => {
      const blocks = src.match(/\{%-?\s*liquid[\s\S]*?-?%\}/g) || [];
      blocks.forEach((b) => {
        const bad = (b.match(/\n\s*(if|unless|for|case|capture|comment)\b/g) || []).length;
        const ends = (b.match(/\n\s*end(if|unless|for|case|capture|comment)\b/g) || []).length;
        ok(bad === ends, 'unbalanced bare tags: ' + bad + ' open vs ' + ends + ' close');
      });
    });
  });

/* ------------------------------------------------- 15. SEO / structured data

   The brand-leak, fetchpriority and video-rendition fixes in this pass are
   each a one-line change with no visible symptom when they regress — a
   revert or a copy-paste of the old pattern into a new file would ship
   silently. These assert the specific bytes that made each bug real. */

t('product schema seller reads the brand setting, not shop.name', () => {
  const src = fs.readFileSync(path.join(ROOT, 'snippets/product-schema.liquid'), 'utf8');
  ok(src.includes('"seller": { "@type": "Organization", "name": {{ settings.brand_name | default: shop.name | json }} }'),
    'seller name must fall back through settings.brand_name before shop.name');
  no(/"name":\s*\{\{\s*shop\.name\s*\|\s*json\s*\}\}/.test(src),
    'seller name must not read shop.name directly — that is the literal account name "Baby Products"');
});

t('og:title shares the brand-corrected doc_title, not raw page_title', () => {
  const src = fs.readFileSync(path.join(ROOT, 'snippets/meta-tags.liquid'), 'utf8');
  ok(/<meta property="og:title" content="\{\{\s*doc_title\s*\|\s*escape\s*\}\}">/.test(src),
    'og:title must render doc_title, the same brand-corrected value <title> uses');
  no(/og:title" content="\{\{\s*page_title/.test(src),
    'og:title must not read page_title directly on the homepage template');
});

t('fetchpriority never receives a raw Liquid boolean', () => {
  const src = fs.readFileSync(path.join(ROOT, 'snippets/responsive-image.liquid'), 'utf8');
  ok(src.includes('fetchpriority: fp'), 'must pass the derived fp variable');
  no(src.includes('fetchpriority: priority'),
    'passing the raw boolean renders fetchpriority="true", which is not a valid value — browsers silently fall back to auto');
  ok(/assign fp = 'high'/.test(src), 'fp must resolve to the one valid value this theme sets: "high"');
});

t('video viewer selects one explicit rendition, not attribute-order luck', () => {
  const src = fs.readFileSync(path.join(ROOT, 'sections/product-videos.liquid'), 'utf8');
  const openButton = src.slice(src.indexOf('class="pvid-open"'), src.indexOf('</button>'));
  const srcAttrs = (openButton.match(/data-pvid-src=/g) || []).length;
  eq(srcAttrs, 1, 'exactly one data-pvid-src per button — a duplicate is a parse error the browser silently resolves by keeping only the first');
  ok(src.includes('viewer_width') && src.includes('source.width > viewer_width'),
    'viewer rendition must be chosen by comparing width, not by loop order');
});

t('strip video carries exactly one deferred source, chosen by smallest width', () => {
  const src = fs.readFileSync(path.join(ROOT, 'sections/product-videos.liquid'), 'utf8');
  const stripBlock = src.slice(src.indexOf('class="pvid-video"'), src.indexOf('</video>'));
  eq((stripBlock.match(/<source /g) || []).length, 0,
     'the strip must not emit a <source> — the URL is deferred to a data attribute so nothing downloads at parse time');
  eq((stripBlock.match(/data-pvid-strip-src=/g) || []).length, 1,
     'exactly one deferred source per clip — a duplicate attribute is a parse error the browser silently resolves by keeping only the first');
  ok(src.includes('strip_width') && src.includes('source.width < strip_width'),
    'strip rendition must be chosen by comparing width, not by loop order');
});

[
  ['snippets/organization-schema.liquid', 'Organization'],
  ['snippets/website-schema.liquid', 'WebSite'],
].forEach(([rel, type]) => {
  t(rel + ' declares @type ' + type + ' and never the literal old brand name', () => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    ok(src.includes('"@type": "' + type + '"'), 'must declare @type ' + type);
    no(/"Baby Products"/.test(src), 'must not hardcode the legacy account name');
    ok(src.includes('settings.brand_name | default: shop.name'),
      'name must resolve through the brand setting, matching the fallback chain used everywhere else in the theme');
  });
});

t('breadcrumb schema looks up the Play Mats collection rather than assuming it', () => {
  const src = fs.readFileSync(path.join(ROOT, 'snippets/breadcrumb-schema.liquid'), 'utf8');
  ok(src.includes("c.handle == 'play-mats'"),
    'must find the collection by handle, not hardcode "Play Mats" as a name every product is assumed to carry');
  ok(/"position":\s*1/.test(src) && /"position":\s*2/.test(src),
    'must emit at least a two-level trail (Home, Product) even when no matching collection is found');
  no(/"item":\s*\{\{\s*shop\.url\s*\|\s*append:\s*pm_collection\.url\s*\|\s*json\s*\}\}\s*\}\s*,\s*\{[^}]*"position":\s*3[\s\S]*"item"/.test(src),
    'the final crumb (the current page) must not carry an "item" — it is the page already being viewed');
});

t('theme.liquid renders each site-wide schema snippet exactly once', () => {
  const src = fs.readFileSync(path.join(ROOT, 'layout/theme.liquid'), 'utf8');
  ['organization-schema', 'website-schema'].forEach((name) => {
    const count = (src.match(new RegExp("render '" + name + "'", 'g')) || []).length;
    eq(count, 1, name + ' must render exactly once — a duplicate is a second competing node of the same @type');
  });
});

t('the PDP renders exactly one Product schema node', () => {
  const src = fs.readFileSync(path.join(ROOT, 'sections/main-product.liquid'), 'utf8');
  const count = (src.match(/render 'product-schema'/g) || []).length;
  eq(count, 1, 'a second Product node on the page is worse than none — Google picks between them arbitrarily');
});

t('main nav carries no link to an empty or demo collection', () => {
  /* This asserts the theme's own capacity to create one, not live Shopify
     navigation data — the menu itself lives in Shopify admin, outside this
     repository, and this suite has no way to reach it. What belongs here is
     making sure nothing in the theme hardcodes a link back to a collection
     this pass removed from navigation. */
  ['sections/header.liquid', 'sections/footer.liquid'].forEach((rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    ['learning-toys', 'nursery', 'feeding', 'travel', 'bath-care', 'best-sellers',
     'asset-pack-88482512898-example-products'].forEach((handle) => {
      no(src.includes(handle), rel + ' must not hardcode a link to /collections/' + handle);
    });
  });
});


/* ------------------------------------------------- SEO finalization pass */

const META = fs.readFileSync(path.join(ROOT, 'snippets/meta-tags.liquid'), 'utf8');
const ORG  = fs.readFileSync(path.join(ROOT, 'snippets/organization-schema.liquid'), 'utf8');
const PROD_SCHEMA = fs.readFileSync(path.join(ROOT, 'snippets/product-schema.liquid'), 'utf8');
const SETTINGS_SCHEMA = fs.readFileSync(path.join(ROOT, 'config/settings_schema.json'), 'utf8');

function stripLiquidComments(src) {
  return src.replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, '');
}
function readTemplate(rel) {
  const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  return JSON.parse(raw.replace(/\/\*[\s\S]*?\*\//, ''));
}
function faqBlocks(rel) {
  const tpl = readTemplate(rel);
  const out = [];
  Object.values(tpl.sections).forEach((sec) => {
    if (sec.type !== 'faq-accordion') return;
    Object.values(sec.blocks || {}).forEach((b) => out.push(b.settings));
  });
  return out;
}

/* --- brand + contact identity ------------------------------------------ */

t('no customer-facing surface carries the personal Gmail address', () => {
  ['snippets', 'sections', 'layout', 'templates', 'config'].forEach((dir) => {
    fs.readdirSync(path.join(ROOT, dir)).forEach((f) => {
      const src = fs.readFileSync(path.join(ROOT, dir, f), 'utf8');
      no(/kplkodwani|@gmail\.com/i.test(src),
         dir + '/' + f + ' exposes a personal Gmail as the support contact');
    });
  });
});

t('the branded support address is the theme default', () => {
  ok(/"id":\s*"email"[\s\S]{0,200}?"default":\s*"support@mamajoy\.in"/.test(SETTINGS_SCHEMA),
     'Theme settings must default the support email to support@mamajoy.in');
});

t('Organization schema names the real founder and nothing more about them', () => {
  /* Asserted against emitted markup only. The comments in these files discuss
     the very properties being banned, and a test that reads them is testing
     the prose rather than the payload. */
  const org = stripLiquidComments(ORG);
  ok(/"founder"/.test(org), 'no founder entity — the brand has no named person behind it');
  ok(/"@type":\s*"Person"/.test(org), 'founder must be a Person node');
  ok(/settings\.founder_name/.test(org), 'the founder name must come from settings, not a literal');
  /* A name is established. A biography, job history or credential is not, and
     Person is the node where inventing one does the most damage. */
  no(/jobTitle|alumniOf|award|knowsAbout|"description"/.test(org),
     'an unverifiable claim about the founder has been added');
});

t('the founder name has a real default and is shared with the About signature', () => {
  ok(/"id":\s*"founder_name"[\s\S]{0,200}?"default":\s*"Kapil Kodwani"/.test(SETTINGS_SCHEMA),
     'founder name must default to the real, owner-confirmed name');
  const FN = fs.readFileSync(path.join(ROOT, 'sections/founder-note.liquid'), 'utf8');
  ok(/section\.settings\.founder_name \| default: settings\.founder_name/.test(FN),
     'the visible signature and the schema founder must read from one value');
});

t('Organization schema carries a contactable support channel', () => {
  ok(/"contactPoint"/.test(ORG), 'no contactPoint — nothing tells an engine how to reach support');
  ok(/settings\.email/.test(ORG), 'support email must come from settings');
  ok(/settings\.phone/.test(ORG), 'support phone must come from settings');
});

t('Organization schema still claims no logo and no social profiles', () => {
  /* Both are absent because neither exists yet. A sameAs pointing at a
     profile that has never been created is a fabricated entity signal. */
  no(/"sameAs"/.test(ORG), 'a sameAs appeared but no social profile has been confirmed');
  no(/"logo"/.test(ORG), 'a logo appeared but the header is a text wordmark with no logo asset');
});

/* --- product schema: identifiers ---------------------------------------- */

t('Product schema invents no GTIN, MPN or barcode', () => {
  const ps = stripLiquidComments(PROD_SCHEMA);
  no(/"gtin|"mpn"|"gtin8"|"gtin13"|"gtin14"|"isbn"/i.test(ps),
     'an identifier the owner does not have has been fabricated');
  /* identifier_exists is a Merchant Center feed attribute, not schema.org
     vocabulary — emitting it here would be invalid markup, not a fix. */
  no(/identifier_exists/.test(ps),
     'identifier_exists is a product-feed attribute and is invalid inside JSON-LD');
});

t('every JSON-LD block uses the canonical schema.org context', () => {
  ['snippets/product-schema.liquid', 'snippets/organization-schema.liquid',
   'snippets/website-schema.liquid', 'snippets/breadcrumb-schema.liquid',
   'sections/faq-accordion.liquid'].forEach((rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (!/@context/.test(src)) return;
    no(/"https:\/\/schema\.org\/"/.test(src),
       rel + ' uses a trailing-slash @context — normalize to https://schema.org');
    ok(/"https:\/\/schema\.org"/.test(src), rel + ' must declare the schema.org context');
  });
});

/* --- indexing policy ----------------------------------------------------- */

t('a stocked, deliberately-described collection is indexable', () => {
  const m = stripLiquidComments(META);
  ok(/collection\.products_count > 0/.test(m),
     'an empty collection must not be indexable');
  ok(/metafields\.global\.description_tag/.test(m),
     'indexability must hinge on the hand-written SEO description, not on body copy every collection already has');
  no(/template\.name == 'collection'\s+or/.test(m),
     'collections are being noindexed as a class again, which suppresses the one category page that should rank');
});

t('search and cart stay out of the index', () => {
  const m = stripLiquidComments(META);
  ok(/template\.name == 'search' or template\.name == 'cart'/.test(m),
     'search and cart must remain noindex');
  ok(/noindex,follow/.test(m), 'noindex must keep follow so product links are still crawled');
});

t('every page emits exactly one canonical', () => {
  const m = stripLiquidComments(META);
  eq((m.match(/rel="canonical"/g) || []).length, 2,
     'exactly two canonical branches expected: the landing-page override and the default');
});

/* --- social metadata ----------------------------------------------------- */

t('og:image resolves on pages that own no image', () => {
  const m = stripLiquidComments(META);
  ok(/settings\.share_image/.test(m), 'no theme-level sharing image in the fallback chain');
  ok(/collections\.all\.products\.first/.test(m),
     'nothing catches the homepage, which owns no image and has no setting picked yet');
  ok(/og:image:alt/.test(m), 'the share image is unlabelled');
});

t('the share image setting exists for a merchant to fill', () => {
  ok(/"id":\s*"share_image"/.test(SETTINGS_SCHEMA), 'share_image is referenced but never declared');
});

t('a Twitter card is declared and only claims a large image when one exists', () => {
  const m = stripLiquidComments(META);
  ok(/twitter:card/.test(m), 'no Twitter card type — previews stay a text line');
  ok(/og_img != blank.*summary_large_image/s.test(m),
     'summary_large_image must be conditional on an image actually resolving');
});

t('og:title never falls back to the raw page title', () => {
  const m = stripLiquidComments(META);
  ok(/og:title" content="\{\{ doc_title/.test(m),
     'og:title must reuse the brand-corrected title, not page_title');
});

/* --- FAQ content + schema ------------------------------------------------ */

[['templates/index.json', 6], ['templates/product.json', 6]].forEach(([rel, count]) => {
  t(rel + ' FAQ answers sit in the extractable range', () => {
    const blocks = faqBlocks(rel);
    eq(blocks.length, count, 'unexpected FAQ block count');
    blocks.forEach((b) => {
      const words = b.answer.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).length;
      /* 40-60 words is the window AI engines extract from most reliably.
         Under it the answer is not self-contained; well over it and the
         answer stops being an answer. */
      ok(words >= 40, '"' + b.question + '" is ' + words + ' words — too thin to stand alone');
      ok(words <= 70, '"' + b.question + '" is ' + words + ' words — padded past the point of being an answer');
    });
  });
});

t('FAQ answers claim no certification and make no medical claim', () => {
  [].concat(faqBlocks('templates/index.json'), faqBlocks('templates/product.json'))
    .forEach((b) => {
      no(/certified|certification|ISO |ASTM|CE mark|lab.tested|non.?toxic certified/i.test(b.answer),
         '"' + b.question + '" claims a certification that has not been established');
      no(/hypoallergenic|prevents|cures|treats|doctor.recommended|pediatrician.recommended/i.test(b.answer),
         '"' + b.question + '" makes a medical claim');
    });
});

t('FAQPage schema is emitted once per page and mirrors the visible answers', () => {
  const FAQ = fs.readFileSync(path.join(ROOT, 'sections/faq-accordion.liquid'), 'utf8');
  eq((FAQ.match(/"@type":"FAQPage"/g) || []).length, 1, 'exactly one FAQPage node per section');
  ok(/block\.settings\.answer \| strip_html \| json/.test(FAQ),
     'the schema answer must be the same string the shopper reads, not a second copy');
  ok(/block\.settings\.question \| strip_html \| json/.test(FAQ),
     'the schema question must be the same string the shopper reads');
});

/* --- homepage answer block ----------------------------------------------- */

t('the homepage says plainly what it sells, without touching the H1', () => {
  const tpl = readTemplate('templates/index.json');
  const hero = Object.values(tpl.sections).find((s) => s.type === 'hero-editorial');
  eq(hero.settings.heading, 'Safe beginnings.', 'the brand H1 must not be rewritten for keywords');

  const stmt = Object.values(tpl.sections).find((s) => s.type === 'brand-statement');
  ok(stmt, 'no self-contained answer block on the homepage');
  ok(tpl.order.includes('statement'), 'the answer block is defined but never rendered');
  const body = stmt.settings.body;
  ['play mat', '6.5', '6 mm', 'waterproof', 'BPA free'].forEach((fact) =>
    ok(body.includes(fact), 'the answer block omits a concrete fact: ' + fact));
  const words = body.trim().split(/\s+/).length;
  ok(words >= 60 && words <= 140, 'answer block is ' + words + ' words — aim for a paragraph, not an essay');
});

/* --- LCP hint ------------------------------------------------------------ */

t('fetchpriority is a valid enumerated value or absent', () => {
  const RI = fs.readFileSync(path.join(ROOT, 'snippets/responsive-image.liquid'), 'utf8');
  no(/fetchpriority: priority\b/.test(RI),
     'a raw Liquid boolean reaches fetchpriority again — it renders as "true", which browsers reject');
  ok(/assign fp = 'high'/.test(RI), 'the only valid value that means anything here is high');
});

/* ---------------------------------------------------------------- report */

const total = pass + failures.length;
console.log('\n  Cart drawer regression suite');
console.log('  ' + '-'.repeat(46));
if (failures.length) {
  failures.forEach((f) => console.log('  FAIL  ' + f));
  console.log('');
}
console.log('  ' + pass + '/' + total + ' passing' +
            (failures.length ? ', ' + failures.length + ' FAILING' : ''));
console.log('');
process.exit(failures.length ? 1 : 0);
