# dsh-motion Context

## Domain Language

- **Surface**: a semantic DOM region with a bounded motion contract (menu,
  listbox, dialog, mask, tab panel, page layer, tab, switch, or stable slot).
- **Motion policy**: the live reduced-motion and theme-token decision used by
  the runtime.
- **Compatibility gate**: visibility, opt-out, host-animation, and exclusion
  checks that must pass before an animation starts.
- **Entry motion**: an animation applied to newly visible content only. The
  plugin never delays host unmounts or clones removed DOM.

## Host Contract

The current Harness semantic markers are `role`, `hidden`, `aria-hidden`,
`aria-selected`, `aria-checked`, `data-phase`, `data-conversation-scroll`, and
`data-slot`. The runtime deliberately avoids CSS-module hashes and fixed
ancestor depth. `data-chat-flow` and its streaming descendants are excluded.

## Compatibility Boundary

Default `light` and `dark` are the tuning baseline. `angelina-light` and
`angelina-dark` change visual tokens and backgrounds without changing the
supported semantics. A layout-changing theme must provide an explicit future
adapter; the classifier fails closed for ambiguous structures.
