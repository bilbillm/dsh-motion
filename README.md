[简体中文](./README.zh-CN.md)

# dsh-motion

`@dsh-external/dsh-motion` is a small, zero-configuration browser plugin for
DeepSeek Harness. It adds restrained entry, exit, and state-change motion to
semantic menus, listboxes, dialogs, tab panels, conversation page layers,
tabs, switches, and workspace disclosure groups.

The plugin is deliberately conservative:

- Harness and theme-owned animation wins. Ambiguous surfaces are skipped.
- Only `opacity`, independent `translate`/`scale`, and color properties are
  used for transient surfaces. Workspace disclosure alone animates its
  semantic group height; AppFrame columns and sidebar geometry remain untouched.
- Menus, listboxes, dialogs, and masks receive paired exits through short-lived
  visual ghosts. Ghosts are `aria-hidden`, inert, pointer-disabled, and removed
  as soon as their animation settles.
- Model and reasoning drill-in cards use a directional through-fade. Command
  option filtering is deliberately excluded so typing never retriggers motion.
- `prefers-reduced-motion` is observed live. Movement and fades are disabled
  when it is enabled.
- There is no settings page, intensity slider, polling loop, or permanent
  animation frame loop.

## Install

Build a source checkout, then install it into an isolated Harness profile with
the normal plugin workflow:

```powershell
pnpm install
pnpm run build
dsh plugin --profile web add C:\path\to\dsh-motion
```

The package includes `cordis.patch.yml`, the `dsh.client` declaration, and the
client bundle expected by the Harness module loader. Restart or reload the
profile after adding it.

An application or theme can opt a subtree out explicitly:

```html
<section data-dsh-motion="off">...</section>
```

## Compatibility

The release is tested against the Harness `0.1.0-rc.5` checkout and the
published `0.1.0-rc.6` client-runtime line. It targets the semantic markers
used by the default `light`/`dark` themes and by `angelina-light`/
`angelina-dark`; it does not depend on CSS-module class hashes.

The following host-owned regions remain outside the plugin's ownership:
AppFrame and sidebar geometry, Trajectory interaction, tooltips, toasts,
composer layout, streaming chat rows, large page-exit clones, and Angelina
parallax layers. Semantic menus/listboxes inside the composer and workspace
tree-group disclosure are the two narrow exceptions. A theme that changes
those semantics should add an explicit adapter rather than broad selectors.

## Development

```powershell
pnpm install
pnpm run check
pnpm run pack:check
```

`pnpm run check` type-checks, builds both halves, and runs the unit, JSDOM, and
bundle smoke tests. The optional browser matrix needs an isolated running Web
profile:

```powershell
$env:DSH_MOTION_E2E_URL = 'http://127.0.0.1:3080/'
pnpm run test:e2e
```

That suite covers the four themes, desktop/narrow viewports, paired transient
exits, model/reasoning card changes, workspace disclosure, dialogs, tabs/tab
panels, layout/focus invariants, and reduced-motion emulation. See
[`docs/compatibility.md`](docs/compatibility.md) for the latest verified host
matrix and explicit gaps.

## Distribution faces

- `.`: the no-op Node half (`apply()`), mounted by the Harness Loader.
- `./client`: the browser half, registered through
  `window.__ModuleLoader__.load({ id, factory })`.
- `./cordis.patch.yml`: the profile patch row.

MIT licensed.
