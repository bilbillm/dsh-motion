# ADR 0001: Semantic Motion Runtime

Status: Accepted

## Context

DeepSeek Harness and its themes are plugin-composed. A motion plugin cannot
depend on React internals, CSS-module hashes, fixed ancestor depth, or ownership
of host positioning transforms. It must coexist with future themes, host-owned
motion, and live accessibility preference changes. Host unmounts happen before
an external observer can run an exit animation on the original node.

## Decision

Use one browser-only runtime behind the standard dual-half DSH package shape.
The runtime classifies a finite set of ARIA and official data markers, batches
MutationObserver records once per animation frame, and uses the Web Animations
API.

Menus, listboxes, dialogs, and masks receive paired entry and exit motion. Exit
motion uses a short-lived visual clone only for these finite transient surfaces.
Every clone is `aria-hidden`, inert, pointer-disabled, stripped of identifiers
and ARIA references, and removed after its owned animations settle. Drill-in
pages that replace the children of one semantic menu use the same mechanism for
a directional through-fade. Listbox filtering does not count as a page change.
When a dialog and its contents mount in one observer batch, the dialog owns the
visual entry while nested state controls retain only their state-transition
markers. A backdrop-filtered dialog temporarily freezes backdrop sampling for
the transition and restores the exact declaration on settlement; exit ghosts
never sample the backdrop and disable pointer targeting across their full tree.

Workspace disclosure is the only layout animation. The runtime finds the tree
group through the nearest `role="tree"` boundary, animates the group height, and
uses fading row ghosts while collapsing. AppFrame columns, sidebar geometry,
scroll containers, and large conversation/page exits remain host-owned and are
never cloned.

Host/theme animation has priority. Hidden, measuring, opted-out, streaming,
Trajectory, Tooltip, Toast, and parallax-layer surfaces fail closed. Semantic
menu/listbox descendants of the composer are eligible while composer layout is
not. Independent `translate`/`scale` components preserve positioning
`transform`; unsupported engines receive opacity-only keyframes.

Reduced motion is a live policy input. Transient motion and visual ghosts become
no-ops, state changes remain immediate, and active plugin animations are
cancelled and cleaned up.

## Consequences

- Visual-only themes inherit compatibility through semantic markers and theme
  tokens with no adapter.
- Layout-changing themes need an explicit narrow adapter rather than broader
  selectors.
- Finite exit ghosts add bounded DOM work during an active transition but no
  idle polling or persistent animation loop.
- Generic page-exit cloning, settings UI, and user-adjustable intensity remain
  outside version one.
- New host surfaces require an eligibility test and an exclusion/ownership
  review before they can join the classifier.
