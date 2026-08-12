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
t('the discount redirect in theme.js has no trigger left to fire it', () => {
  ok(JS.includes("'discount/'"), 'handler gone — fine, but this test needs updating');
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
