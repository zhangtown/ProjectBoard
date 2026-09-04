# 项目看板（ProjectBoard）改造概览

> 四个目标：① 上传 GitHub ② 改为轻量化桌面端 ③ design-taste-frontend 重塑 ④ 修拖动卡顿
> 状态：**①②③④ 代码侧均已完成**；GitHub 推送后台执行中（见第 5 节）。

## 1. 拖拽卡顿定位与修复（已修复）
**根因**：原 `tick()` 每帧（requestAnimationFrame）都调用 `updateDropTarget() → flip()`，`flip()` 对
**看板里所有卡片**逐个 `getBoundingClientRect()` 强制同步重排，并给每张卡重启 CSS 过渡 + 绑定 `transitionend`。
指针连续移动时插入位置不断变化，`flip()` 被每帧重复触发，造成「布局抖动 + 过渡重启风暴」。此外
`autoScroll` 与 `updateDropTarget` 每帧各调一次 `document.elementFromPoint`（重复强制布局）。

**修复**：
- `tick()` 每帧只做一次 `elementFromPoint`，结果同时传给 `autoScroll` 与 `updateDropTarget`。
- 拖拽中改为**直接 `insertBefore` 轻量占位移动**（真实卡片半透明占位 + ghost 跟手），不再对全员跑 FLIP。
- 仅插入位置真正变化时移动一次，目标列加 `is-drop-target` 高亮。
- `will-change: transform` 从「所有卡片」收敛到 `.is-dragging` / `.drag-ghost`。

## 2. 视觉重塑（design-taste-frontend 原则，保留式）
> 该技能范围不含 dashboard，此处仅取其「反套路设计原则」做 UI 重塑，不套落地页套路。

- **单一强调色**：teal `#0E7C72`（主操作），列语义色（蓝/琥珀/绿）仅作状态标识。
- **形状半径一致**：统一 `--r-sm/md/lg/xl` 尺度。
- **克制 GPU 动效**：仅动画 `transform/opacity`，`prefers-reduced-motion` 全量降级。
- **暗色主题**：`prefers-color-scheme: dark` 一套 token，亮/暗自动切换，对比度达 WCAG AA。
- 全部 JS 依赖的 class 名保持不变，无功能回退。

## 3. 轻量化桌面端（Neutralino）
> 本机无 Rust（Tauri 不可用）；Electron 体积大不符「轻量化」。Neutralino 用系统 WebView2，
> 运行时仅 ~2-3MB，真原生窗口、不跑浏览器。

- Web 资源在 `resources/`（相对引用依旧有效）。
- `neutralino.config.json`：窗口 1280×820、原生 API 白名单 `app.*/os.*/window.*/filesystem.*`、
  窗口图标 `resources/appicon.png`（青底三列卡片，脚本生成）。
- `package.json`：`neu run`（开发预览原生窗口）/ `neu build --release`（产出 exe）。
- Excel 导出桌面端分支：`window.Neutralino && window.NL_OS` 判定真实运行时 →
  `Neutralino.os.showSaveDialog` + `Neutralino.filesystem.writeFile`；浏览器回退锚点下载。
  注意：必须用 `window.NL_OS` 而非 `window.Neutralino`（引入客户端库后浏览器里该对象也存在，会误触连接）。
- 已接入 `@neutralinojs/lib`（`resources/js/neutralino.js`，随页面打包；`app.js` 启动时 `Neutralino.init()`）。
- 本地数据沿用 `localStorage`（WebView2 内持久化于应用数据目录）。

### 构建 / 运行
```bash
npm install                 # 装 @neutralinojs/neu 与 @neutralinojs/lib
npm run update              # 或：neu update —— 拉框架二进制到 bin/（仅需一次）
npm run start               # 开发预览（原生窗口）
npm run build               # 产出 dist/ProjectBoard/ProjectBoard-win_x64.exe + -release.zip
```

> ⚠️ **构建踩坑（已修复，记录备查）**
> 1. `neu build` 报 `stat '...<root>\undefined'`：本机 neu v10 的 `bundler.js` 第 35 行
>    `fse.copy('./'+icon, ...)` **无判空保护**，`modes.window.icon` 缺失即崩溃。已补
>    `resources/appicon.png` 并在配置写 `icon: "resources/appicon.png"`。
> 2. 该 neu 版本用的是 `cli.resourcesPath`（非 `cli.resources`），缺失同样触发 `./undefined` 拷贝，已改回。
> 3. `cli.binaryOutputPath` 在本 neu 版本被忽略，输出实际为 `dist/<binaryName>/<binaryName>-win_x64.exe`。
> 4. 框架二进制落在 `bin/`（非 `.neu/`）；`bin/` 与 `dist/` 均已在 `.gitignore` 忽略，克隆后需 `neu update`。
>
> 🔐 **代理 TLS 拦截（本沙箱特有）**：若处于做 HTTPS 中间人解密的代理下，`neu update` 下载会
> `unable to verify the first certificate`。临时绕过：`NODE_TLS_REJECT_UNAUTHORIZED=0 neu update`
> （仅下载环节放开，正常使用无需此步）。你本机若无此类代理可忽略。

## 4. GitHub 上传（仓库已建，推送中）
- 仓库：`https://github.com/zhangtown/ProjectBoard`。
- 提交历史（本地 `master`）：
  - `581d407` feat：桌面端改造 + 拖拽修复 + 视觉重塑
  - `04eef66`  chore：补充 overview 与锁文件、忽略 `.tmp`
  - `77c697d`  fix：补全 icon/`cli.resourcesPath` + 接入客户端库实现桌面原生另存为
- 推送 `master → refs/heads/main` 后台执行中（PAC 代理对写偶发卡住，按经验后台重试可通，可能耗时数分钟至二十余分钟）。
  完成后 `git ls-remote --heads origin` 应显示 `main` = `77c697d`。

## 文件结构
```
ProjectBoard/
├─ neutralino.config.json      # 窗口/图标/原生 API 白名单
├─ package.json                # neu run / neu build / neu update
├─ .gitignore                  # 忽略 node_modules/ .neu/ dist/ bin/ *.exe resources.neu .tmp/ .workbuddy/
├─ overview.md
└─ resources/
   ├─ index.html               # 引入 neutralino.js（先于 app.js）
   ├─ appicon.png              # 窗口图标（脚本生成）
   ├─ css/styles.css           # 重塑后样式（含暗色主题）
   └─ js/
      ├─ app.js                # 拖拽引擎已优化 + 导出桌面端分支 + Neutralino.init()
      ├─ neutralino.js         # @neutralinojs/lib（随页面打包）
      └─ xlsx.js               # 零依赖 XLSX 生成
```

## 已知注意
- `bin/`（~22MB 框架二进制）与 `dist/`（产物）不入库，克隆后先 `npm install && neu update` 再 `neu build`。
- 首次打开桌面端若 WebView2 未安装，Windows 会提示安装（Neutralino 依赖系统 WebView2）。
