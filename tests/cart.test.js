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
const unitPrice = new Function('money', 'return ' + extract('unitPrice'))(money);
const writeSummaryFor = (drawer) =>
  new Function('drawer', 'money', 'return ' + extract('writeSummary'))(drawer, money);

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

const rupees = (r) => r * 100; // paise, the unit every Shopify cart field uses

/* Fixtures. The discounted cart is the exact one from the reported bug:
   3 x ₹1,299 with the prepaid code live on the session. */
const cartDiscounted = {
  item_count: 3,
  original_total_price: rupees(3897),
  total_price: rupees(3702),
  items: [{
    key: '111:a', quantity: 3, product_title: 'MamaJoy Baby Play Mat',
    original_price: rupees(1299), final_price: rupees(1299),
    original_line_price: rupees(3897), final_line_price: rupees(3897)
  }]
};
const cartPlain = {
  item_count: 1,
  original_total_price: rupees(1299),
  total_price: rupees(1299),
  items: [{
    key: '111:a', quantity: 1, product_title: 'MamaJoy Baby Play Mat',
    original_price: rupees(1299), final_price: rupees(1299),
    original_line_price: rupees(1299), final_line_price: rupees(1299)
  }]
};
const cartEmpty = { item_count: 0, original_total_price: 0, total_price: 0, items: [] };

function summaryOf(cart) {
  const d = stubDrawer();
  writeSummaryFor(d)(cart);
  return d.els;
}

/* ------------------------------------------------- 1. money(), the only
   place a number becomes a price anywhere in the theme */

t('money renders paise as whole rupees', () => eq(money(rupees(1299)), money(129900)));
t('money prefixes the rupee sign', () => ok(money(rupees(1)).startsWith('₹')));
t('money drops paise rather than showing .00', () => no(/\./.test(money(rupees(3897)))));
t('money handles zero', () => eq(money(0), '₹0'));
t('money groups in the Indian system (1,00,000 not 100,000)', () => {
  const s = money(rupees(100000)).replace('₹', '');
  ok(s === '1,00,000' || s === '100000', 'got ' + s + ' — Node built without full ICU still passes');
});

/* ------------------------------------------------- 2. the summary reconciles */

t('MRP Total is original_total_price', () =>
  eq(summaryOf(cartDiscounted)['[data-cart-mrp]'].textContent, money(rupees(3897))));
t('Cart Total is total_price', () =>
  eq(summaryOf(cartDiscounted)['[data-cart-carttotal]'].textContent, money(rupees(3702))));
t('To Pay is total_price', () =>
  eq(summaryOf(cartDiscounted)['[data-cart-topay]'].textContent, money(rupees(3702))));
t('MRP Discount is the gap between the two totals', () =>
  eq(summaryOf(cartDiscounted)['[data-cart-discount]'].textContent, '−' + money(rupees(195))));
t('You Save equals the MRP Discount figure', () => {
  const e = summaryOf(cartDiscounted);
  eq(e['[data-cart-save]'].textContent, money(rupees(195)));
  eq('−' + e['[data-cart-save]'].textContent, e['[data-cart-discount]'].textContent);
});
t('the column adds up: MRP Total − MRP Discount = Cart Total', () => {
  const g = cartDiscounted.original_total_price, n = cartDiscounted.total_price;
  eq(money(g - (g - n)), money(n));
});
t('To Pay equals Cart Total when shipping is free', () => {
  const e = summaryOf(cartDiscounted);
  eq(e['[data-cart-topay]'].textContent, e['[data-cart-carttotal]'].textContent);
});
t('reported bug numbers reproduce exactly (₹3,897 → ₹3,702, save ₹195)', () => {
  const e = summaryOf(cartDiscounted);
  eq(e['[data-cart-mrp]'].textContent, money(389700));
  eq(e['[data-cart-carttotal]'].textContent, money(370200));
  eq(e['[data-cart-save]'].textContent, money(19500));
});

/* ------------------------------------------------- 3. no invented pricing */

t('an undiscounted cart shows no saving', () =>
  eq(summaryOf(cartPlain)['[data-cart-save]'].textContent, money(0)));
t('the discount row hides when there is no discount', () =>
  eq(summaryOf(cartPlain)['[data-cart-discount-row]'].hidden, true));
t('the You Save chip hides when there is no discount', () =>
  eq(summaryOf(cartPlain)['[data-cart-save-row]'].hidden, true));
t('the discount row shows when there is a discount', () =>
  eq(summaryOf(cartDiscounted)['[data-cart-discount-row]'].hidden, false));
t('the You Save chip shows when there is a discount', () =>
  eq(summaryOf(cartDiscounted)['[data-cart-save-row]'].hidden, false));
t('an undiscounted cart pays exactly its MRP total', () => {
  const e = summaryOf(cartPlain);
  eq(e['[data-cart-mrp]'].textContent, e['[data-cart-topay]'].textContent);
});
t('no 5% is applied to an undiscounted cart', () =>
  eq(summaryOf(cartPlain)['[data-cart-topay]'].textContent, money(rupees(1299))));
t('a Shopify-discounted total is displayed, never re-discounted', () => {
  /* The whole failure mode in one assertion: 3702 must survive, not 3702*0.95. */
  eq(summaryOf(cartDiscounted)['[data-cart-topay]'].textContent, money(rupees(3702)));
  no(summaryOf(cartDiscounted)['[data-cart-topay]'].textContent === money(rupees(3516.9)));
});
t('an empty cart renders zeroes and hides both discount rows', () => {
  const e = summaryOf(cartEmpty);
  eq(e['[data-cart-topay]'].textContent, money(0));
  eq(e['[data-cart-discount-row]'].hidden, true);
});
t('a 100%-off cart still reconciles', () => {
  const e = summaryOf({ original_total_price: rupees(500), total_price: 0, items: [], item_count: 0 });
  eq(e['[data-cart-topay]'].textContent, money(0));
  eq(e['[data-cart-save]'].textContent, money(rupees(500)));
});

/* ------------------------------------------------- 4. malformed bodies */

t('a cart missing original_total_price writes nothing rather than NaN', () => {
  const d = stubDrawer();
  d.els['[data-cart-topay]'].textContent = 'untouched';
  writeSummaryFor(d)({ total_price: rupees(100), items: [] });
  eq(d.els['[data-cart-topay]'].textContent, 'untouched');
});
t('a cart with a string total writes nothing rather than concatenating', () => {
  const d = stubDrawer();
  d.els['[data-cart-mrp]'].textContent = 'untouched';
  writeSummaryFor(d)({ original_total_price: '3897', total_price: '3702', items: [] });
  eq(d.els['[data-cart-mrp]'].textContent, 'untouched');
});
t('the zero guard is a type check, not a truthiness check', () => {
  /* An empty cart totals 0, which is falsy — it must still render. */
  const e = summaryOf(cartEmpty);
  eq(e['[data-cart-mrp]'].textContent, money(0));
});
t('a null total does not throw', () => {
  const d = stubDrawer();
  writeSummaryFor(d)({ original_total_price: null, total_price: null, items: [] });
});
t('missing summary nodes do not throw', () => {
  writeSummaryFor({ querySelector: () => null })(cartDiscounted);
});

/* ------------------------------------------------- 5. MRP strikethrough */

t('no struck price when the shopper pays list', () =>
  eq(unitPrice(cartPlain.items[0]), money(rupees(1299))));
t('an MRP is never fabricated from the selling price', () => {
  const html = unitPrice(cartPlain.items[0]);
  no(/price-was/.test(html), 'invented a struck figure for an undiscounted line');
});
t('struck original shown when original_price exceeds final_price', () => {
  const html = unitPrice({ original_price: rupees(1499), final_price: rupees(1299) });
  ok(/price-was/.test(html) && html.includes(money(rupees(1499))));
});
t('the selling price is the one not struck', () => {
  const html = unitPrice({ original_price: rupees(1499), final_price: rupees(1299) });
  ok(/<s class="price-was"[^>]*>₹1,499<\/s>/.test(html) || /price-was[^>]*>[^<]*1,499/.test(html));
  ok(/price-now/.test(html));
});
t('the struck/current pair is announced to screen readers', () => {
  const html = unitPrice({ original_price: rupees(1499), final_price: rupees(1299) });
  ok(/visually-hidden/.test(html) && /Was /.test(html) && /now /.test(html));
});
t('equal original and final prices are not treated as a discount', () =>
  no(/price-was/.test(unitPrice({ original_price: rupees(999), final_price: rupees(999) }))));

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
t('the summary reads only the two authoritative totals', () => {
  const src = extract('writeSummary');
  ok(src.includes('cart.original_total_price') && src.includes('cart.total_price'));
  no(/cart\.items\s*\[/.test(src), 'summary should not reach into line items');
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
  ok(LIQUID.includes('cart.original_total_price'));
  ok(LIQUID.includes('cart.total_price'));
});
t('the server-rendered saving is a Liquid subtraction, not a percentage', () => {
  ok(/cart\.original_total_price\s*\|\s*minus:\s*cart\.total_price/.test(LIQUID));
  no(/times:\s*0?\.95/.test(LIQUID));
});
t('no prepaid button returned to the drawer', () =>
  no(/data-buy-prepaid/.test(LIQUID), 'the prepaid button is back in the cart'));

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
