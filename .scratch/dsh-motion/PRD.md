Status: ready-for-human

Implementation: complete; published at https://github.com/bilbillm/dsh-motion

# dsh-motion：DeepSeek Harness 克制型界面动效插件

## Problem Statement

DeepSeek Harness 的产品能力、界面组件和主题都通过插件组合。默认界面中的菜单、列表框、对话框、标签页和开关在出现或切换时缺少统一、克制的运动反馈，导致状态变化显得突然；但动效插件不能假设只有一种页面结构，也不能破坏主题插件对颜色、字体和视觉层次的控制。

当前需要一个可独立安装的浏览器插件，优先适配默认主题 `light` 和 `dark`，同时完整适配现有两个不改变页面排版的自定义主题 `angelina-light` 和 `angelina-dark`。插件还应为未来可能改变 DOM 结构或页面排版的主题保留清晰的降级和适配边界。

## Solution

构建独立的 `dsh-motion` 浏览器插件，通过 DeepSeek Harness 的 bundle patch 和 client plugin 加载机制安装一个轻量 Motion Runtime。Runtime 使用语义化 DOM 信息、MutationObserver 和 Web Animations API，在不接管宿主组件状态的前提下为有限的界面状态增加进入、切换和反馈动效。

动效读取宿主主题提供的缓动和时长 token，不写死颜色、背景、阴影或字体。动画优先使用 `opacity`、独立的 `translate`、`scale` 和颜色过渡，避免覆盖菜单定位或主题已有的 `transform`。所有动画都尊重 `prefers-reduced-motion`，并在用户运行时切换系统偏好后立即生效。

正式兼容目标分为三层：

- 默认主题 `light`、`dark`：完整实现和重点验收。
- 现有视觉型主题 `angelina-light`、`angelina-dark`：完整实现和同等回归验证。
- 未来仅改变颜色、字体、圆角等视觉属性的主题：依赖语义选择器和继承样式自动兼容；改变 DOM 语义或页面排版的主题：保持安全降级，并通过后续适配器扩展。

## User Stories

1. As a DeepSeek Harness user, I want to install the motion plugin through the normal profile plugin workflow, so that no host source modification is required.
2. As a DeepSeek Harness user, I want a menu to enter with a short, subtle fade and displacement, so that I can understand where the new surface came from without waiting for it.
3. As a DeepSeek Harness user, I want a submenu to use the same motion language as its parent menu, so that nested navigation feels coherent.
4. As a DeepSeek Harness user, I want command and option listboxes to reveal their contents smoothly, so that keyboard and pointer navigation have clear visual feedback.
5. As a DeepSeek Harness user, I want a dialog and its mask to appear as one coordinated transition, so that the modal state feels intentional rather than abrupt.
6. As a DeepSeek Harness user, I want dialog focus to remain on the same logical control while the entry animation runs, so that animation never interrupts keyboard work.
7. As a DeepSeek Harness user, I want a newly selected tab panel to appear with a brief transition, so that I can tell which content changed.
8. As a DeepSeek Harness user, I want tab selection and active option changes to retain their existing ARIA state, so that assistive technology and keyboard behavior remain correct.
9. As a DeepSeek Harness user, I want switch controls to animate their visual state change without delaying the actual value change, so that feedback and application state stay synchronized.
10. As a DeepSeek Harness user, I want newly shown slot content to enter briefly when appropriate, so that dynamic panels do not pop into existence without context.
11. As a DeepSeek Harness user, I want hover and focus color transitions to use the active theme's tokens, so that the plugin does not impose an unrelated palette.
12. As a user of the default light theme, I want every supported surface to be tuned against the light theme's spacing and contrast, so that the motion remains legible and restrained.
13. As a user of the default dark theme, I want every supported surface to behave like the light theme while preserving dark theme colors and contrast, so that switching color schemes does not disable motion.
14. As a user of the Angelina Light theme, I want menus, dialogs, tabs, and switches to keep their Angelina visual treatment while animating, so that the plugin enhances rather than flattens the theme.
15. As a user of the Angelina Dark theme, I want the same compatibility guarantees as Angelina Light, so that the dark variant does not require a separate manual workaround.
16. As a theme author who only changes visual tokens, I want the plugin to discover surfaces through roles, slots, and state attributes, so that changing class names or colors does not break motion.
17. As a theme author who changes page layout, I want unsupported structures to fail closed without corrupting the UI, so that a missing adapter cannot cause broken positioning or focus.
18. As a user who enables reduced motion, I want movement to be disabled while essential state changes remain visible, so that the interface respects my accessibility preference.
19. As a user who changes the reduced-motion preference while Harness is open, I want subsequent transitions to follow the new preference immediately, so that I do not need to reload the page.
20. As a keyboard user, I want pointer hit testing and focus rings to remain available during transitions, so that I can continue interacting without timing tricks.
21. As a user with a long conversation or scrollable panel, I want animations to preserve scroll position and layout dimensions, so that content does not jump when a surface appears.
22. As a user, I want an element to animate at most once per state change, so that rapid DOM mutations do not produce flicker or repeated motion.
23. As a user, I want existing sidebar, tooltip, toast, workspace, and trajectory animations to remain unchanged, so that the plugin does not override motion already owned by Harness.
24. As a profile maintainer, I want the plugin to dispose its observer, listeners, and active animations when the client plugin is unloaded, so that profile switching does not leak work into later sessions.
25. As a profile maintainer, I want the plugin to be safe when the host has no matching surface, so that partial or future Harness builds can still load it.
26. As a plugin maintainer, I want motion policy decisions to be isolated from DOM classification, so that new surfaces can be added without rewriting theme or lifecycle logic.
27. As a plugin maintainer, I want a built client artifact and a verifiable bundle patch, so that users can install the plugin using the documented ecosystem workflow.
28. As a plugin maintainer, I want compatibility checks against the current local Harness checkout and the published release line, so that an update to either side produces a clear failure signal.
29. As a contributor, I want tests to describe observable motion eligibility, accessibility preservation, and lifecycle behavior, so that refactors do not silently broaden the animation scope.
30. As a user, I want concise installation and compatibility documentation, so that I can enable or disable the plugin without reading its implementation.
31. As a maintainer, I want the repository to remain suitable for later publication under the `dsh-plugin` topic, so that the plugin can be discovered by the community once it is stable.

## Implementation Decisions

- The plugin is an independent browser-focused package. Its distribution contribution uses the Harness bundle patch mechanism, and its runtime contribution is a Cordis client plugin. The Node-side contribution is a minimal no-op needed only to mount the client bundle.
- The runtime is split into deep modules with small interfaces:
  - `MotionPolicy` resolves active theme tokens, reduced-motion state, and the fixed validated duration policy.
  - `SurfaceClassifier` maps semantic elements and state changes to a finite set of motion intents without depending on CSS Module hashes or fixed ancestor depth.
  - `MotionRuntime` owns observation, intent deduplication, Web Animations API execution, cancellation, and teardown.
  - `ThemeCompatibility` reads inherited computed values and detects whether a surface is safe to animate without overriding a host-owned positioning transform.
  - The Cordis client adapter owns installation and lifecycle effects and exposes no new host application state.
- Stable semantic signals are the primary integration surface: ARIA roles for menus, listboxes, dialogs, tabs, tab panels, and switches; official `data-slot` markers; and documented state attributes. Broad descendant scans, polling, React state interception, and CSS-module hash selectors are prohibited.
- Observation is event-driven. The runtime scans only added subtrees and relevant attribute changes, schedules at most one intent per element and state transition, and has no steady-state animation frame loop.
- Web Animations API is used for transient motion. The runtime prefers independent CSS transform components where browser support allows them, so menu placement transforms remain owned by the host. It never animates layout properties such as width, height, top, left, or position.
- Theme colors, easing, and durations come from inherited theme tokens and computed styles. If a required token is unavailable, the policy uses a short validated fallback and records the reason through development diagnostics; it does not invent a palette.
- The default light and dark themes are the primary tuning baseline. `angelina-light` and `angelina-dark` are required acceptance targets because they alter visual tokens and imagery without changing the supported surface semantics.
- Themes that change layout or replace semantics are handled conservatively: the classifier may skip an ambiguous node, and a future explicit adapter registry may add support. Version one does not attempt to infer arbitrary structural replacements.
- Accessibility and host behavior are invariant: ARIA attributes, focus, keyboard order, pointer hit testing, scroll position, and application state must be unchanged before and after an animation. Reduced motion suppresses non-essential movement rather than suppressing state updates.
- Existing host-owned animations are outside the plugin's ownership. Surface classification must exclude the known sidebar, tooltip, toast, workspace, and trajectory animation roots unless an explicit future adapter opts in.
- Version one is deliberately zero-configuration. Surface eligibility and duration bounds are fixed and conservative, while `prefers-reduced-motion` remains the user-controlled accessibility policy.
- The compatibility target is the current local Harness integration line and the published `@deepseek-ai/dsh` release line represented by `0.1.0-rc.6`. Dependencies use the scoped Cordis package expected by that line.
- The plugin does not clone removed DOM nodes to manufacture exit animations. Entry and state-change transitions are the reliable external-plugin surface for version one.

## Testing Decisions

- Tests assert externally observable behavior: which semantic surfaces are eligible, whether an animation intent is emitted once, whether state and accessibility attributes are preserved, and whether teardown stops future work. Tests should not lock in private helper names or a particular Web Animations API call sequence.
- `SurfaceClassifier` receives focused unit coverage for menu, submenu, listbox, dialog, mask, tab, tab panel, switch, slot content, ambiguous nodes, and excluded host-owned roots.
- `MotionPolicy` receives unit coverage for light, dark, Angelina Light, Angelina Dark, missing tokens, duration validation, reduced-motion at startup, and live media-query changes.
- `MotionRuntime` receives JSDOM lifecycle coverage for subtree insertion, relevant attribute mutation, deduplication, cancellation, focus and ARIA preservation, scroll stability, reduced-motion no-op behavior, and complete disposal.
- The Cordis client adapter receives a lifecycle test proving installation and unload dispose observers, media-query listeners, and active animations exactly once.
- The built bundle receives a smoke test with a fake Harness module loader. The test proves that the client entry is discoverable, the Node entry does not require browser globals, and the patch metadata composes with a profile.
- An isolated profile composition test installs the local package through the same `dsh plugin --profile web add .` workflow used by users, then boots the browser graph.
- Playwright visual and interaction tests cover menus, nested menus, command listboxes, settings dialogs, conversation and settings tabs, switches, and dynamic slot content under `light`, `dark`, `angelina-light`, and `angelina-dark`.
- Playwright runs at desktop and narrow viewport sizes and with `prefers-reduced-motion` enabled. Assertions include no layout shift, preserved focus, intact hit testing, stable scroll position, and no console errors.
- Performance checks verify that no polling or persistent frame loop exists, that only added subtrees are scanned, and that steady-state observer work is zero when the page is idle.
- Prior art for composition and artifact checks includes the official plugin template, the minimal browser-only navbar plugin, the full client bundle example, and the ecosystem plugin checker. Existing Harness UI-theme tests provide the theme identifier and token vocabulary baseline.

## Out of Scope

- Redesigning page layout, spacing, typography, colors, icons, or component hierarchy.
- Replacing or rewriting the default theme or either Angelina theme.
- Guaranteeing automatic support for themes that replace DOM semantics or substantially rearrange layout.
- Generic exit animations that require cloning or delaying host-owned unmounts.
- Animating every element or applying a global `transition` rule.
- Overriding existing sidebar, tooltip, toast, workspace, or trajectory animations.
- Adding a new host motion service, changing Harness React components, or modifying the agent loop.
- Analytics, remote configuration, telemetry, or a continuously running animation scheduler.
- A mobile-specific visual redesign; narrow viewport behavior is limited to compatibility and no-regression validation.
- Publishing to GitHub or adding topics in this PRD phase; publication follows implementation and verification.

## Further Notes

- The local repository is intentionally independent from the existing `deepseek-harness` fork. The first implementation should inspect the exact current semantic markers before freezing selectors and should record any resolved terminology in the repository context document.
- Acceptance requires the four built-in theme identifiers `light`, `dark`, `angelina-light`, and `angelina-dark`, with the default pair treated as the tuning baseline and the Angelina pair treated as first-class compatibility targets.
- A release is ready when the plugin can be installed in an isolated profile, all focused tests and browser checks pass, reduced motion is verified, and no supported surface causes layout or focus regressions.
- Suggested implementation sequence: repository and manifest scaffold; policy and classifier; runtime and lifecycle adapter; artifact and profile smoke tests; Playwright theme matrix; documentation and release packaging.
- After the local implementation is stable, create the GitHub repository under the confirmed owner, push over SSH, and add `dsh-plugin`, `dsh`, and `deepseek-harness` topics so the repository appears on the community topic page.
- If a future theme needs structural support, add a narrowly scoped adapter and its compatibility tests rather than weakening the semantic classifier with theme-specific ancestor or class-name assumptions.

## Implementation Outcome

- Implemented the dual-half package, insertion patch, token/reduced-motion
  policy, semantic classifier, theme compatibility gate, observer/runtime, and
  Cordis lifecycle adapter.
- Added focused unit/JSDOM, lifecycle, bundle, package, and optional Playwright
  matrix coverage. The default suite passes against published `rc.6` types.
- Installed the package into an isolated local `rc.5` Web profile and verified
  all four themes at desktop and narrow viewports with no page-level overflow
  or console errors.
- Browser QA found and fixed two overly broad exclusions: Angelina's parallax
  ownership marker lives on `body`, and settings dialogs live below the
  sidebar slot. Only actual parallax layers/sidebar content remain excluded.
- The current host does not expose a live submenu, non-Trajectory switch, or
  conversation tab in a blank isolated profile. Those semantic paths are
  covered by focused tests and remain in the opt-in Playwright suite for a
  seeded profile.
- Published the public repository with `dsh-plugin`, `dsh`, and
  `deepseek-harness` topics for ecosystem discovery.
