# MamaJoy — Product & Marketing Profile

*Reference for all marketing/ads/CRO skills. Real, verified figures are marked (verified); everything else is a stated assumption — treat assumptions as provisional, not fact.*

## Business & offer

- **Brand:** MamaJoy — Indian D2C baby-products brand, founded by Kapil Kodwani, Raipur, Chhattisgarh.
- **Store:** Shopify Basic plan, live at mamajoy.in.
- **Products (2 SKUs, one category — play mats):**
  - MamaJoy Baby Play Mat – Alphabets & Numbers (`MJ-PM-ALPHA-01`)
  - MamaJoy Baby Play Mat – Toys & Cars (`MJ-PM-CARS-01`)
  - Both: 6.5 × 5 ft, 6mm XPE foam, waterproof, folds in 3 panels, BPA/phthalate-free, ages 0–3.
- **Price:** ₹1,299 each, both SKUs identical price (verified, live).
- **GST:** 18% IGST included in list price — net of tax is ≈ ₹1,101 (verified from order #1013).
- **COGS:** ₹500 per unit — **assumption, not confirmed**. Every break-even figure in this profile moves if the real number differs. Get this confirmed before trusting any CPA target.
- **Other unit costs (assumed):** shipping ₹80, prepaid gateway fee ₹26, COD collection fee ₹30, packaging ₹30.
- **Margin note:** contribution per *delivered* order ≈ ₹465 (prepaid) / ₹502 (COD), before ad spend — see Economics below for how RTO changes this.

## Customer

- **Geography:** India only (domestic shipping zone; international rate exists but is not the focus).
- **Buyer:** parents of infants/toddlers (0–3 yrs), likely also a gifting audience (grandparents/relatives).
- **Stated audience hint for ads:** age 25–45, all genders — used as an Advantage+ *hint*, not a hard filter.
- **Payment behavior:** COD-heavy market. Live checkout offers UPI/cards (via Razorpay) and Cash on Delivery (+₹49 handling fee, gated to a dedicated shipping-rate/Besure rule).
- **Known objections (from real reviews):** mat thickness (6mm) vs. thicker premium mats — one reviewer raises it and self-resolves ("price is less"); grip on tiled/marble floors is a live FAQ on the PDP.

## Goal

- **Primary channel launching now:** Meta Ads (Facebook & Instagram), because "the whole platform is owned by Meta."
- **Conversion event:** Purchase (Shopify order), optimizing on Meta's Purchase objective despite low initial volume — deliberate choice over Add to Cart to avoid training the pixel on window-shoppers.
- **Not yet in scope:** retargeting (pool too small at current budget), Google/other platforms.

## Economics

- **Current ad budget:** ₹200/day (moved down from an initial ₹300/day plan; user is scaling up as orders come in, not down).
- **Break-even CPA (verified formula, assumption-dependent inputs):**
  | RTO assumption | Blended break-even CPA | Scale-up target (70% of break-even) |
  |---|---|---|
  | 25% (working assumption) | ₹370 | ₹259 |
  | 35% | ₹321 | ₹225 |
  | 40% (plausible for a new COD-heavy brand) | ₹297 | ₹208 |
  - RTO (return-to-origin / COD refusal rate) is **unconfirmed** — store has only 2 COD orders placed, neither delivered yet as of this profile. This is the single most important number to update once real delivery data exists.
  - Formula: revenue net of 18% GST, minus COGS/shipping/fees/packaging = contribution per *delivered* order; RTO orders cost ~₹190 each in wasted outbound+return+packaging with zero revenue; blended 70% COD / 30% prepaid mix.
- **Interim steering metric (until enough purchases accumulate):** cost per Add-to-Cart. Break-even ATC cost ≈ ₹74 at 25% RTO, tightening to ≈ ₹59 at 40% RTO (assumes ~1-in-5 ATC→purchase rate).
- **Scaling ladder:** ₹200→₹300 after 14 days if cost/ATC < ₹75 and ≥5 orders; →₹450, →₹650 on similar gates; above ₹650, 15–20% steps, max one raise per 3 days. Never raise budget and launch new creative same day.
- **High-leverage economics lever (not yet decided by owner):** bundling both mats at ₹2,299 (vs ₹2,598 separately) lifts break-even CPA headroom by ~56% (₹329→₹512 at 25% RTO, COD). Pricing decision — awaiting sign-off, not yet built.

## Time horizon

- Store just went live; this is the **first paid-traffic launch**, no prior ad history.
- No fixed deadline stated — budget scales opportunistically as orders/data come in, per owner's explicit preference over a fixed ramp schedule.

## Constraints

- Not a regulated category (no finance/health/alcohol restrictions), but avoid unsubstantiated developmental/health claims (e.g. "boosts brain development") in creative — policy risk and trust issue, not just a legal one.
- Payment platform: Razorpay (live mode confirmed working as of order #1010+). COD fee mechanism runs through a duplicated Shopify shipping rate + Besure Checkout Rules gating (Shopify's checkout-rules app can reorder/hide/rename payment & shipping methods but cannot inject a fee itself — confirmed from its own rule catalog).
- Creative assets on hand: 11 product photographs, 6 UGC video clips (all one angle — a mother demonstrating the mat). No budget/time yet for new video shoots — current ad creative plan deliberately favors statics over video for this reason.
- Reviews: 12 total, 4.25★, **identical on both SKUs** — imported from another provider (photos link to Amazon CDN URLs), not organic to this store yet. Treat as brand-level social proof, not product-specific proof, until real post-purchase reviews accumulate. Target: 10 real photo reviews within 30 days of first deliveries.

## Current state

- Store: live, orders flowing, checkout previously had a payment-gateway test-mode bug and a COD-fee-not-charging bug — **both confirmed fixed** as of live orders #1010–#1015.
- Ads account: brand new, no history, Meta Pixel/Dataset + Facebook & Instagram sales channel installed on Shopify (verified). Purchase-event firing on real orders **not yet independently verified** — Meta's `webPixel` API scope isn't available to check this from the coding assistant; verify manually in Events Manager.
- Current live Meta plan: 1 campaign, 1 ad set, 3 ads launched (grounded in real reviews/specs/FAQs), 2 more ads held in reserve for retargeting/month 2. Full plan: see the published artifact from this session (₹200/day launch runbook with break-even tables, creative copy, and week-by-week gates).

---
*Last updated from a live working session that included direct Shopify Admin API verification of orders, payment gateway status, shipping rates, and review data — not just claims. Update the assumption-marked figures (COGS, RTO) the moment real numbers exist; they change every break-even and target-CPA figure downstream.*
