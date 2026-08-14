# ADR 0001: Semantic Entry Motion

Status: Accepted

## Context

DeepSeek Harness and its themes are plugin-composed. A motion plugin cannot
depend on React internals, CSS-module hashes, fixed ancestor depth, or ownership
of host layout transforms. It must also coexist with future themes and live
accessibility preference changes.

## Decision

Use one browser-only runtime behind the standard dual-half DSH package shape.
The runtime classifies a finite set of ARIA and official data markers, batches
MutationObserver records once per animation frame, and uses Web Animations API
entry effects. It never manufactures exit DOM or delays host unmounts.

Host/theme animation has priority. Hidden, measuring, opted-out, streaming,
composer, workspace, Trajectory, Tooltip, Toast, and parallax-layer surfaces
fail closed. Independent `translate`/`scale` components preserve positioning
`transform`; unsupported engines receive opacity-only keyframes.

Reduced motion is a live policy input. Transient entry effects become no-ops,
state changes remain immediate, and active plugin animations are cancelled.

## Consequences

- Visual-only themes inherit compatibility through semantic markers and theme
  tokens with no adapter.
- Layout-changing themes need an explicit narrow adapter rather than broader
  selectors.
- Generic exit animation, settings UI, and user-adjustable intensity remain
  outside version one.
- New host surfaces require an eligibility test and an exclusion/ownership
  review before they can join the classifier.
