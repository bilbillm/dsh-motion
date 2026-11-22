# Compatibility and QA

## Host Lines

- Supported runtime lines: DeepSeek Harness `0.1.x` (original QA baseline
  `0.1.0-rc.5` source checkout, `feature/angelina-themes`, commit
  `ed90f252829c59e4949c09006d64d215afa909d4`) and `0.2.x` (current published
  line `0.2.2-rc.5`).
- Compatibility declaration: `engines.dsh: >=0.1.0-rc.5 <0.3.0` is checked by
  0.2.x boot; `0.1.x` does not evaluate `engines.dsh`. The Cordis peer remains
  `>=4.0.1 <5` and is satisfied by both `4.0.1` (0.1.x) and `~4.1.0` (0.2.x).
- Client contract shared by both lines: `Context` from `@deepseek-ai/cordis`
  (0.1.x re-exported it as `ClientContext`), `ctx.effect(execute, label)`,
  `window.__ModuleLoader__.load({ id, factory })`, an empty client `inject`
  roster, and the bundle `cordis.patch.yml` insert. `@deepseek-ai/dsh-client-runtime`
  existed only in 0.1.x and is no longer referenced.
- Dev typecheck line: `@deepseek-ai/cordis@4.1.0`, whose `Context`/`effect`
  surface matches `4.0.1`. 0.2.2-rc.5 itself requires Node >=24.9; this
  repository builds and tests on Node 22, so the 0.2.x web profile matrix has
  not been re-run locally after the compatibility change.

## Automated Checks

`pnpm run check` covers policy, classifier, compatibility, runtime lifecycle,
client lifecycle, package metadata, bundle registration, and the Node half.
The assertions include:

- one animation per semantic state change and same-frame coalescing;
- paired, inaccessible exit ghosts for menu, listbox, dialog, and mask removal;
- directional through-fades for model/reasoning menu-page replacement without
  retriggering command-list filtering;
- workspace tree-group height motion and fading removed-row ghosts;
- dialog-owned entry batching and temporary backdrop-filter suspension for
  large glass surfaces, including exact style restoration;
- host WAAPI/CSS animation precedence and `data-dsh-motion="off"`;
- live reduced-motion changes and cancellation;
- focus, ARIA, scroll, and layout invariants;
- no polling or persistent animation frame loop;
- observer, animation, style, state-marker, and media-listener teardown;
- fake `window.__ModuleLoader__` registration and parseable bundle insertion.

`pnpm run test:e2e` is opt-in through `DSH_MOTION_E2E_URL`. It records the
actual WAAPI calls before app boot, asserts independent `translate` rather than
the positioning `transform`, emulates reduced motion, and captures theme/
viewport screenshots under `work/qa/playwright/`.

## Manual Browser Matrix

The local `rc.5` Web profile was installed through `dsh plugin --profile web
add .` in an isolated `DSH_HOME`. The client style marker loaded and the page
console remained free of warnings and errors.

| Surface | Light | Dark | Angelina Light | Angelina Dark |
| --- | --- | --- | --- | --- |
| Model/reasoning card drill-in | Pass | Pass | Pass | Pass |
| Command and permission paired exit | Pass | Pass | Pass | Pass |
| Settings dialog and mask paired exit | Pass | Pass | Pass | Pass |
| Workspace expand/collapse | Pass | Pass | Pass | Pass |
| Settings tab and tabpanel | Pass | Pass | Pass | Pass |
| Desktop 1440x900 overflow | Pass | Pass | Pass | Pass |
| Narrow 390x844 overflow | Pass | Pass | Pass | Pass |
| Plugin runtime/style loaded | Pass | Pass | Pass | Pass |

The dialog remained inside the viewport, did not change dimensions during tab
switches, retained focus inside the modal, and produced no document-level
horizontal overflow. Transient exit clones remained inert and disappeared at
settlement. Workspace groups interpolated between measured heights and removed
rows faded without changing the selected tree item. Angelina parallax layers
remained present while ordinary UI motion stayed enabled; only
`data-dsh-angelina-layer` subtrees are excluded.

An Angelina Light regression probe with Chromium CPU throttled 4x reduced the
settings-dialog average worst frame gap from about 72ms to 50ms on entry and
from about 67ms to 17ms on exit. The entry batch now emits only dialog and mask
motion instead of seven overlapping animations. These figures document the
local comparison rather than define a portable CI timing threshold.

## Current Host Gaps

- The only production `role="switch"` found is inside Trajectory, which is an
  explicit host-owned exclusion. Switch state behavior is covered by JSDOM.
- A blank isolated profile cannot expose conversation view tabs or an active
  transcript without a workspace/model flow. Conversation `data-phase` and
  page-entry behavior are covered at the runtime boundary.
- The in-app Browser has no reduced-motion emulation capability. Initial and
  live preference changes are covered by unit/JSDOM tests; the optional
  Playwright matrix provides real-browser emulation.
