[简体中文](./README.zh-CN.md)

# dsh-motion

`@dsh-external/dsh-motion` is a small, zero-configuration browser plugin for
DeepSeek Harness. It adds short entry motion to semantic menus, listboxes,
dialogs, tab panels, conversation page layers, and state changes on tabs and
switches.

The plugin is deliberately conservative:

- Harness and theme-owned animation wins. Ambiguous surfaces are skipped.
- Only `opacity`, independent `translate`/`scale`, and color properties are
  animated. Layout, positioning transforms, dimensions, and scroll containers
  are left alone.
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
sidebar/layout geometry, workspace and trajectory interaction, tooltips,
toasts, composer surfaces, streaming chat rows, and Angelina parallax layers.
A theme that changes those semantics should add a narrow adapter rather than
relying on broad selectors.

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

That suite covers the four themes, desktop/narrow viewports, menus, dialogs,
tabs/tab panels, layout/focus invariants, and reduced-motion emulation. See
[`docs/compatibility.md`](docs/compatibility.md) for the latest verified host
matrix and explicit gaps.

## Distribution faces

- `.`: the no-op Node half (`apply()`), mounted by the Harness Loader.
- `./client`: the browser half, registered through
  `window.__ModuleLoader__.load({ id, factory })`.
- `./cordis.patch.yml`: the profile patch row.

MIT licensed.
