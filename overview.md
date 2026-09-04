# 项目看板（ProjectBoard）改造概览

> 四个目标：①上传 GitHub ②改为轻量化桌面端 ③design-taste-frontend 重塑 ④修拖动卡顿

## 1. 拖拽卡顿定位与修复（已修复）
**根因**：原 `tick()` 每帧（requestAnimationFrame）都调用 `updateDropTarget() → flip()`，
`flip()` 会对**看板里所有卡片**逐个 `getBoundingClientRect()` 强制触发同步布局重排，
并给每张卡启动/重启 CSS 过渡动画 + 绑定 `transitionend` 监听。指针连续移动时插入位置不断改变，
`flip()` 被每帧重复触发，造成「布局抖动 + 过渡重启风暴」。此外 `autoScroll` 与 `updateDropTarget`
每帧各调用一次 `document.elementFromPoint`（重复强制布局）。

**修复**：
- `tick()` 每帧只做一次 `elementFromPoint`，结果同时传给 `autoScroll` 与 `updateDropTarget`（去掉重复命中测试）。
- 拖拽中改为**直接 `insertBefore` 轻量占位移动**（真实卡片半透明占位 + ghost 跟手），不再对全员跑 FLIP 重排动画。
- 仅在插入位置真正变化时移动一次，并给目标列加 `is-drop-target` 高亮。
- `will-change: transform` 从「所有卡片」收敛到 `.is-dragging` / `.drag-ghost`，避免无谓的 GPU 图层开销。

## 2. 视觉重塑（design-taste-frontend 原则，保留式）
> 该技能本身范围不含 dashboard；此处仅取其「反套路设计原则」做产品 UI 重塑，不套落地页套路。

- **单一强调色**：teal（操作/主按钮），列语义色（蓝/琥珀/绿）仅作状态标识，不与之争抢。
- **形状半径一致**：统一 `--r-sm/md/lg/xl` 尺度，全站复用。
- **克制 GPU 动效**：仅动画 `transform/opacity`，`prefers-reduced-motion` 全量降级。
- **暗色主题**：新增 `prefers-color-scheme: dark` 一套 token，亮/暗自动切换，对比度达 WCAG AA。
- 顶栏玻璃质感、卡片悬浮微抬升、表单聚焦环、计数胶囊等细节打磨；**全部 JS 依赖的 class 名保持不变**。

## 3. 轻量化桌面端（Neutralino）
> 本机无 Rust（Tauri 不可用）；Electron 体积大不符「轻量化」。Neutralino 用系统 WebView2，运行时仅 ~2-3MB，真原生窗口、不跑浏览器。

- Web 资源移入 `resources/`（结构不变，相对引用依旧有效）。
- 新增 `neutralino.config.json`（窗口 1280×820、原生 API 白名单）、`package.json`（`neu run` / `neu build`）。
- Excel 导出增加桌面端分支：`Neutralino.os.showSaveDialog` + `Neutralino.filesystem.writeFile`；
  浏览器回退到锚点下载（同一份代码，自动按运行环境切换）。
- 本地数据沿用 `localStorage`（WebView2 内持久化于应用数据目录），零额外改动、低风险。

**本地构建/运行**（在本机网络正常时）：
```bash
npm install
npm run start     # 开发预览（原生窗口）
npm run build     # 产出 dist/ProjectBoard.exe
```

## 4. 上传 GitHub
- 仓库：`https://github.com/zhangtown/ProjectBoard`（已建，初始为空）。
- 已 `git init` 并提交（commit `581d407`，含 resources/ 与 Neutralino 配置，`.gitignore` 忽略 node_modules/dist/.workbuddy 等）。
- `git push -u origin HEAD:refs/heads/main` 在后台执行中（PAC 代理对写偶发卡住，按此前经验后台重试可通，可能耗时数分钟至二十余分钟）。推送成功后我会补报。

## 文件结构
```
ProjectBoard/
├─ neutralino.config.json
├─ package.json
├─ .gitignore
└─ resources/
   ├─ index.html
   ├─ css/styles.css      # 重塑后样式（含暗色主题）
   └─ js/
      ├─ app.js           # 拖拽引擎已优化 + 导出桌面端分支
      └─ xlsx.js          # 零依赖 XLSX 生成
```
