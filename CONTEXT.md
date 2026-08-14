# dsh-motion Context

## Domain Language

- **Surface**: a semantic DOM region with a bounded motion contract (menu,
  listbox, dialog, mask, tab panel, page layer, tab, switch, workspace
  disclosure, or stable slot).
- **Motion policy**: the live reduced-motion and theme-token decision used by
  the runtime.
- **Compatibility gate**: visibility, opt-out, host-animation, and exclusion
  checks that must pass before an animation starts.
- **Visual ghost**: a short-lived, inert clone used only to finish the exit of
  a finite transient surface after the host has unmounted it.
- **Paired motion**: entry and exit effects for menus, listboxes, dialogs, and
  masks; drill-in menu pages use a directional through-fade.

## Host Contract

The current Harness semantic markers are `role`, `hidden`, `aria-hidden`,
`aria-selected`, `aria-checked`, `aria-expanded`, `data-phase`,
`data-conversation-scroll`, and `data-slot`. The runtime deliberately avoids
CSS-module hashes and fixed ancestor depth. `data-chat-flow` and its streaming
descendants are excluded.

## Compatibility Boundary

Default `light` and `dark` are the tuning baseline. `angelina-light` and
`angelina-dark` change visual tokens and backgrounds without changing the
supported semantics. Workspace ownership is limited to semantic tree-group
disclosure; AppFrame columns and sidebar geometry remain host-owned. Large
page and conversation DOM is never cloned for exit motion. A layout-changing
theme must provide an explicit future adapter; the classifier fails closed for
ambiguous structures.
