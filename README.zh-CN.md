[English](./README.md)

# dsh-motion

`@dsh-external/dsh-motion` 是一个面向 DeepSeek Harness 的轻量、零配置浏览器插件。它为具有稳定语义标记的菜单、列表框、对话框、标签面板、对话页面内容层、Tab、Switch 和工作区分组展开状态增加短促、克制的进入、退场与状态切换动效。

插件有意保持保守：

- Harness 或主题自带的动画优先；无法可靠判断的界面会被跳过。
- 瞬态界面只动画 `opacity`、独立的 `translate`/`scale` 和颜色属性。只有工作区语义分组会动画自身高度；AppFrame 列宽和侧栏几何仍由宿主管理。
- 菜单、列表框、对话框和遮罩使用成对退场效果。退场副本始终设置为 `aria-hidden`、`inert`、不可点击，并在动画结束后立即移除。
- 模型和推理等级卡片换页采用带方向提示的 through-fade；命令列表筛选不会因选项更新而反复触发动效。
- 对话框挂载时由外层面板统一负责入场，内部 slot 不会重复动画。带 `backdrop-filter` 的玻璃面板只在短动画期间暂停背景采样，结束后精确恢复主题原声明。
- 实时监听 `prefers-reduced-motion`；启用减少动态效果后，会关闭位移和淡入。
- 不增加设置页面、强度滑杆、轮询或常驻动画帧循环。

## 安装

构建源码后，通过 Harness 的标准插件流程安装到隔离 profile：

```powershell
pnpm install
pnpm run build
dsh plugin --profile web add C:\path\to\dsh-motion
```

包中包含 `cordis.patch.yml`、`dsh.client` 声明和 Harness 模块加载器需要的客户端 bundle。安装后请重启或重新加载对应 profile。

应用或主题可以显式关闭某个子树的动效：

```html
<section data-dsh-motion="off">...</section>
```

## 兼容性

当前版本针对本地 Harness `0.1.0-rc.5` 源码和已发布的 `0.1.0-rc.6` 客户端运行时依赖进行测试。插件适配默认的 `light`/`dark` 主题和 `angelina-light`/`angelina-dark` 主题所使用的语义标记，不依赖 CSS Module 哈希类名。

以下由宿主负责的区域不属于插件的控制范围：AppFrame 与侧栏几何、Trajectory 交互、Tooltip、Toast、Composer 排版、流式对话行、大型页面退场副本以及 Angelina 视差图层。Composer 内的语义菜单/列表框和工作区树分组展开是两个范围明确的例外。改变这些语义的主题应增加显式适配器，而不是依赖宽泛选择器。

## 开发

```powershell
pnpm install
pnpm run check
pnpm run pack:check
```

`pnpm run check` 会执行类型检查、构建 Node/Browser 两个 half，并运行单元测试、JSDOM 测试和 bundle 冒烟测试。可选浏览器矩阵需要一个正在运行的隔离 Web profile：

```powershell
$env:DSH_MOTION_E2E_URL = 'http://127.0.0.1:3080/'
pnpm run test:e2e
```

该测试矩阵覆盖四个主题、桌面和窄屏视口、瞬态界面的成对退场、模型/推理卡片换页、工作区展开折叠、对话框、Tab/Tabpanel、布局与焦点不变量，以及减少动态效果模拟。最新的宿主验证矩阵和明确保留的测试缺口见 [`docs/compatibility.md`](docs/compatibility.md)。

## 分发入口

- `.`：由 Harness Loader 挂载的无操作 Node half（`apply()`）。
- `./client`：通过 `window.__ModuleLoader__.load({ id, factory })` 注册的浏览器 half。
- `./cordis.patch.yml`：profile patch row。

采用 MIT 许可证。
