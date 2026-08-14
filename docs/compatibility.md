# Compatibility and QA

## Host Lines

- Local source checkout: DeepSeek Harness `0.1.0-rc.5`, branch
  `feature/angelina-themes`, commit
  `ed90f252829c59e4949c09006d64d215afa909d4`.
- Published type/dependency line: `@deepseek-ai/dsh-client-runtime@0.1.0-rc.6`
  with `@deepseek-ai/cordis@4.0.1`.
- Package peer range: runtime `>=0.1.0-rc.5 <0.2.0`, Cordis
  `>=4.0.1 <5`.

## Automated Checks

`pnpm run check` covers policy, classifier, compatibility, runtime lifecycle,
client lifecycle, package metadata, bundle registration, and the Node half.
The assertions include:

- one animation per semantic state change and same-frame coalescing;
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
| Menu positioning | Pass | Pass | Pass | Pass |
| Settings dialog and mask | Pass | Pass | Pass | Pass |
| Settings tab and tabpanel | Pass | Pass | Pass | Pass |
| Desktop 1440x900 overflow | Pass | Pass | Pass | Pass |
| Narrow 390x844 overflow | Pass | Pass | Pass | Pass |
| Plugin runtime/style loaded | Pass | Pass | Pass | Pass |

The dialog remained inside the viewport, did not change dimensions during tab
switches, retained focus inside the modal, and produced no document-level
horizontal overflow. Angelina parallax layers remained present while ordinary
UI motion stayed enabled; only `data-dsh-angelina-layer` subtrees are excluded.

## Current Host Gaps

- The current composition has no interactive production submenu; nested menus
  are covered by classifier/runtime tests against the shared semantic contract.
- The only production `role="switch"` found is inside Trajectory, which is an
  explicit host-owned exclusion. Switch state behavior is covered by JSDOM.
- A blank isolated profile cannot expose conversation view tabs or an active
  transcript without a workspace/model flow. Conversation `data-phase` and
  page-entry behavior are covered at the runtime boundary.
- The in-app Browser has no reduced-motion emulation capability. Initial and
  live preference changes are covered by unit/JSDOM tests; the optional
  Playwright matrix provides real-browser emulation.
