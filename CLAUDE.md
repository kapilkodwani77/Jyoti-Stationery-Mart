# MamaJoy — working notes

Shopify theme for MamaJoy (mamajoy.in). Products: Play Mat, Baby Carrier,
Feeding Pillow.

## Skills — consult before working, not after

These are installed in this repository so they load in every session, local or
remote. Skills installed on a personal machine do not reach a session running in
a remote container; that is why they live here.

**Any change to how the site looks, reads, or converts requires the relevant
skill below to be loaded first.** Reaching for a skill after writing the code is
the same as not using it.

### Design and interface — `.claude/skills/`

| Skill | Use for |
|---|---|
| `ui-ux-pro-max` | Any UI decision. Has a searchable database — run its `scripts/search.py`; if a query returns 0 results, say so rather than inventing an answer. |
| `impeccable` | Design critique, audit, polish of an existing interface |
| `frontend-design` | Visual direction, typography, avoiding templated defaults |
| `ui-styling`, `design-system`, `brand` | Tokens, component specs, brand consistency |
| `banner-design`, `slides` | Creative assets, presentations |

### Marketing and conversion — `.agents/skills/` (49 skills)

Most relevant to this store, in rough order of use:

`cro` · `copywriting` · `offers` · `marketing-psychology` · `pricing` ·
`ab-testing` · `ad-creative` · `ads` · `analytics` · `attribution` · `popups` ·
`emails` · `sms` · `social` · `video` · `seo-audit` · `schema` · `ai-seo` ·
`site-architecture` · `programmatic-seo` · `content-strategy` · `copy-editing` ·
`customer-research` · `competitor-profiling` · `competitors` · `signup` ·
`onboarding` · `churn-prevention` · `referrals` · `launch` · `image` ·
`marketing-ideas` · `marketing-plan` · `marketing-loops` · `marketing-council` ·
`free-tools` · `lead-magnets` · `public-relations` · `influencer-marketing` ·
`community-marketing` · `co-marketing` · `directory-submissions` ·
`prospecting` · `cold-email` · `sales-enablement` · `revops` · `paywalls` ·
`aso` · `product-marketing` · `find-skills`

Rough mapping: cart or PDP conversion work → `cro`; any customer-facing wording
→ `copywriting`; anything framed as a deal, bonus, guarantee or deadline →
`offers`; ad work → `ads` + `ad-creative`.

## Honesty rules for customer-facing copy

Non-negotiable, and reinforced by the `offers` skill's own banned-vocabulary
list:

- **No "limited time" without a real deadline.** The `offers` skill classifies
  this as lying. Standing MRP discounts are not time-limited offers.
- No fake scarcity, countdown timers, or invented stock counts.
- No fabricated reviews, ratings, or testimonials.
- No MRP manipulation — struck prices must be real compare-at prices.
- No product claims that are not verified. When a supplied spec sheet
  contradicts itself, flag it and stop; do not resolve it silently.
- Unresolved: the Feeding Pillow's broader tummy-time / sitting / play use
  claim. The source material contradicts itself on whether it is feeding-only.
  **Do not use the broader claims in production copy until confirmed.**

## Prices

Play Mat ₹1,299 prepaid. COD adds ₹49 (₹1,348). Shipping free. The ₹49 is
currently configured as a *shipping rate* named "Cash on Delivery", not a
payment fee — nothing links it to the payment method chosen, so a customer can
take COD on the free rate or pay online on the ₹49 rate. Unresolved.

## Theme deployment

The Shopify Admin API **blocks writes to the live (MAIN) theme.** Work on an
unpublished theme and let the owner publish.

There is no deploy script. Theme files are pushed with `themeFilesUpsert`, which
replaces the whole file — so a long file must be reproduced exactly.

**Always verify after a push:** query the file's `size` and `checksumMd5` back
and compare against the local file. Transcribing a 13KB Liquid file by hand is
where corruption enters; the checksum is what catches it. Prefer adding
behaviour in small isolated files (`mj-features.css`, `mj-features.js`) over
editing `theme.css` (67KB).

`mj-features.css` is linked *after* `theme.css` in `layout/theme.liquid`, so
overrides there win on source order without inflating specificity.

## Known repo/theme drift

The repository is behind the live theme on:

- `layout/theme.liquid` — repo 4178 bytes, theme 4567 (theme has the
  `mj-features` link and script tags, repo does not)
- `assets/mj-features.js` — exists only in the theme, never committed

## Open bugs

- `switzer-regular.woff2`, `switzer-medium.woff2`, `switzer-semibold.woff2`,
  `gambetta-light.woff2`, `gambetta-regular.woff2` and `favicon.png` are
  referenced by `layout/theme.liquid` but **do not exist in the theme** — every
  one 404s, so the site renders in fallback system fonts with no favicon.
- Razorpay Magic Checkout only intercepts a real cart form submit
  (`<button name="checkout">`). The drawer's plain `<a href="/checkout">`
  bypasses it. Converting it makes Magic Checkout fire — but a
  "This store can't accept payments right now" error appeared on that path and
  is not yet explained. Do not publish that change until it is.
