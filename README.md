# babycare-theme-v1 — Shopify theme (MamaJoy / BabyCare)

Source for the custom Online Store 2.0 theme on `kychgh-y5.myshopify.com`
(theme id `148654653549`, currently **unpublished**).

Standard Shopify theme layout, so the Shopify CLI works directly:

```bash
shopify theme dev                      # local preview
shopify theme push --theme 148654653549
shopify theme pull --theme 148654653549
```

## Architecture

- `assets/theme.css` — the only global stylesheet. Tokens, reset, base, layout
  primitives, the components shared across templates (buttons, price, quantity
  stepper, photography plates) and the always-present chrome (header,
  announcement bar, footer, cart drawer, sticky buy bar).
- `assets/section-*.css` / `component-*.css` — loaded by the individual section
  that uses them via `stylesheet_tag`, so a template only pays for what it
  renders. Required for OS 2.0, where merchants can move sections between
  templates.
- `assets/theme.js` — one deferred file; every module guards on element
  existence and is scoped by data-attribute, not id.
- `snippets/product-card.liquid` — the single product card, shared by the
  homepage showcase, the collection grid and search.
- `snippets/spec.liquid` — renders `product.metafields.custom.*` with an
  editor-only placeholder when a value has not been filled in yet.

## Design tokens

Colour, spacing, radii and motion are defined once in the `@layer tokens` block
of `theme.css` and are deliberately not merchant-editable.

Text colour is `--ink` (primary) or `--ink-2` (secondary). Do not reach for
`opacity` to lighten small text: at 12–14px anything below roughly 62% opacity
on `--ink` drops under the WCAG AA 4.5:1 floor. Levels below secondary come
from size, weight and letter-spacing instead.

Use only these breakpoints: **700 / 900 / 1100 / 1200px**.
