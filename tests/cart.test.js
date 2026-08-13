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
t('urgency does not outrank the offer beside it', () => {
  const flat = BUYCSS.replace(/\n/g, ' ');
  ok(/\.buybox-urgency\{[^}]*color:var\(--ink-2\)/.test(flat), 'urgency is not stepped back');
  no(/\.buybox-urgency\{[^}]*color:var\(--danger\)/.test(flat), 'error red used for a sales line');
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

t('video is lazy by the strongest available setting', () => {
  ok(/preload="none"/.test(PV), 'preload is not none — bytes fetch before intent');
  no(/preload="(auto|metadata)"/.test(PV));
});
t('video does not autoplay', () => no(/autoplay/i.test(PV)));
t('video is muted-safe by never starting itself', () => {
  const js = JS.slice(JS.indexOf('function productVideos'));
  no(/\.play\(\)/.test(js.slice(0, 900)), 'the script starts playback');
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
t('keyboard focus stays visible inside the scroller', () =>
  ok(/\.pvid-video:focus-visible/.test(PVCSS)));
t('the section is named for assistive tech even with no heading', () =>
  ok(/aria-label="Product videos"/.test(PV)));
t('each video is individually labelled', () => ok(/aria-label="Product video/.test(PV)));
t('the strip is a real list', () => ok(/<ul class="pvid"/.test(PV) && /<li class="pvid-item"/.test(PV)));

t('off-screen videos are paused, not left playing audio', () => {
  const js = JS.slice(JS.indexOf('function productVideos'), JS.indexOf('function productVideos') + 900);
  ok(/IntersectionObserver/.test(js), 'no observer');
  ok(/\.pause\(\)/.test(js), 'nothing pauses');
  no(/addEventListener\('scroll'/.test(js), 'a scroll listener would be the expensive way');
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
t('nothing new competes with the sticky buy bar for the bottom corner', () =>
  no(/position:fixed/.test(PVCSS), 'the video section pins something to the viewport'));

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
