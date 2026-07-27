# REC / CTRL — 录播姬控制中心

[![Cross-platform CI](https://github.com/demogest/BiliRecControl/actions/workflows/ci.yml/badge.svg)](https://github.com/demogest/BiliRecControl/actions/workflows/ci.yml)

基于 Tauri 2、Next.js 16 与 Rust 构建的跨平台本地控制软件。界面面向监控大屏设计，通过录播姬 REST API 展示房间、直播、录制、网络、文件写入和日志状态，并提供常用录制控制。

## 功能

- 实时总览：房间数、直播数、录制数、平均录制速度、网络吞吐、本次写入
- 房间矩阵：主播、标题、分区、节点、录制时长、文件大小、网络速率
- 主播头像：从哔哩哔哩抓取 128×128 头像并缓存到本机，断网或失败时回退姓名缩写
- 房间筛选与搜索：全部、录制中、直播中、离线
- 控制操作：开始、停止、手动分段、刷新、添加和删除房间
- 添加房间：支持输入纯房间号或粘贴 Bilibili 直播间 URL，并自动提取房间号
- 按需运行日志：错误、警告、信息分类与游标增量更新，默认收起以扩大房间矩阵
- 连接设置：API 地址、Basic Auth 用户名和密码、连接测试
- 大屏模式：自动刷新间隔与全屏切换
- 录制资料库：按房间统计历史视频数、弹幕 XML 数、占用空间和最新录制时间
- 文件管理：跨房间或单房间浏览、搜索、类型筛选、排序和复制服务端文件路径
- MPV 播放：由 Rust 后端查找本机 MPV，并携带 Basic Auth 播放录播姬文件
- 录制快捷方案：稳妥录制、高质量归档、轻量省空间，修改先进入草稿再确认保存
- 画质快捷设置：原画优先、最高画质优先、AVC 兼容和节省空间，并保留原画兜底
- 详细录制设置：常用参数优先展示，网络、超时和桌面参数默认收进高级区域
- 房间独立设置：自动录制、录制模式、分段、弹幕、画质、封面和标题过滤
- 房间详情：分别读取房间信息、录制统计和 IO 统计，并显示 objectId
- 文件名模板工具：提供标准、按月、按分区和后期友好预设，并使用真实房间上下文预览路径
- 应用内更新：自动或手动检查 GitHub Releases，显示版本说明与下载进度，签名验证通过后安装并重启

## 通讯边界

```text
Next.js WebView
    │ 仅 Tauri IPC
    ▼
Rust 后端命令
    ├─ 校验 /api 与 /file 路径 + 组装 Basic Auth → 录播姬 REST API
    └─ 校验房间号、图片域名、格式与大小 → 哔哩哔哩公开直播接口及图片 CDN
```

前端代码不使用 `fetch`、XHR 或第三方 HTTP 客户端。所有对外 HTTP 请求只发生在 Rust 后端。
主播头像使用系统应用缓存目录保存 128×128 WebP，缓存有效期为 7 天；刷新失败时会继续使用旧缓存，单个房间失败不会影响主界面或资料库。

历史文件管理目前是只读的。录播姬 2.18.0 OpenAPI 未提供远程文件删除接口，因此本软件不会绕过 API 操作录播服务器文件。

画质 ID、录制模式和文件名模板语法以录播姬官方说明为准：

- [画质与其他录制设置](https://rec.danmuji.org/reference/settings/)
- [Standard 与 Raw 录制模式](https://rec.danmuji.org/user/modes/)
- [Liquid 文件名模板](https://rec.danmuji.org/reference/filename-template/)

## 下载与平台支持

Pull Request 会自动执行格式化、Changelog、前端构建、测试和 Rust Clippy 检查。每次推送 `main` 在完整检查通过后，都会构建并上传 Windows x64、Linux x64 和 macOS Universal 三组临时 CI 包；也可在 GitHub Actions 中手动运行。带 `v` 前缀的版本标签仍会使用完整平台矩阵，自动发布带 Tauri 更新签名的正式 Release。

| 系统    | 架构                           | 安装包             | 便携包       |
| ------- | ------------------------------ | ------------------ | ------------ |
| Windows | x64                            | NSIS、MSI          | 独立 EXE ZIP |
| Windows | ARM64                          | NSIS               | 独立 EXE ZIP |
| Linux   | x64、ARM64                     | AppImage、DEB、RPM | AppImage ZIP |
| macOS   | Intel x64、Apple Silicon ARM64 | APP、DMG           | APP ZIP      |
| macOS   | Universal                      | APP、DMG           | APP ZIP      |

CI 的临时产物保留 7 天；正式版本可从 [GitHub Releases](https://github.com/demogest/BiliRecControl/releases) 长期下载。便携包不等于完全不写本机数据，限制与运行要求见 [PORTABLE.md](PORTABLE.md)。

Windows 和 macOS 的操作系统级可信代码签名需要购买相应开发者证书，目前 CI 生成的是未做系统证书签名的包，首次运行可能出现安全提示。应用内更新使用独立的 Tauri 签名机制，下载内容被篡改时客户端会拒绝安装。

## 启动开发环境

需要 Node.js 20+、Rust stable 和目标系统的 Tauri 构建依赖。Windows 还需要 C++ Build Tools 与 WebView2 Runtime。播放历史录制需要 MPV；软件会自动搜索 `PATH`、WinGet、Scoop 和常见安装目录，也可通过 `MPV_PATH` 环境变量指定播放器路径。

```powershell
npm install
npm run tauri:dev
```

首次打开会显示连接设置。填写录播姬服务根地址、Basic Auth 用户名和密码后，点击“保存并连接”。

提交前可使用统一命令格式化并运行完整检查：

```powershell
npm run format
npm run check
```

`npm run check` 会验证 Prettier、Rustfmt、提交标题、Next.js 构建、Node/Rust 测试和 Clippy。

## 贡献与提交规范

本仓库根据 Git 提交记录自动生成版本 Changelog。所有进入 `main` 的非合并提交都必须使用约定的 Conventional Commit 标题；允许的 type、scope、破坏性变更格式、示例及发布提交要求见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 本地构建

```powershell
npm run tauri:build
```

日常本地构建使用 `--no-sign`，因此不需要接触发布私钥。默认 Windows NSIS 安装程序输出到：

```text
src-tauri\target\release\bundle\nsis\
```

正式发布由 [Publish signed release](.github/workflows/release.yml) 工作流完成。发布前需要让 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 的版本一致，再推送同版本标签：

```powershell
git tag v1.4.0
git push origin v1.4.0
```

工作流会验证标签与包版本一致，为 Windows、Linux 和 macOS 的 x64/ARM64 构建安装包与便携 ZIP，生成 `latest.json`，最后发布 Release。清单中的安装包地址固定到当前版本的公开 GitHub Release 下载地址；发布前会验证平台、签名、仓库和标签，发布后还会以匿名请求探测元数据及全部安装包，避免把需要 API 凭据或无法公开访问的地址交给客户端。更新私钥只保存在 GitHub Actions 的 `TAURI_SIGNING_PRIVATE_KEY` Secret 中；仓库和应用仅包含公钥。

发布前会自动查找上一个版本标签，并根据两个标签之间的非合并 Git 提交生成 Changelog。符合 [提交规范](CONTRIBUTING.md) 的提交会自动归入“新功能、问题修复、性能优化、重构、文档、工程维护”等分组；生成内容会覆盖 Draft Release 的 Release Note，工作流重跑时也会同步刷新。不合规提交会中止发布。

可在本地预览尚未发布的提交说明：

```powershell
npm run changelog
```

## 应用内更新

桌面程序启动 4 秒后会静默检查稳定更新通道，也可点击顶栏的下载图标手动检查。发现新版本后，先由用户下载并完成签名校验，再由用户确认“安装并重启”，避免下载完成后立即打断当前操作。检查、下载、校验、安装和重启错误会分别提示；下载失败时也可直接前往 Release 页面手动安装。

更新源固定为：

```text
https://github.com/demogest/BiliRecControl/releases/latest/download/latest.json
```

Tauri 会校验更新元数据和安装包签名。私钥一旦丢失，现有客户端将无法验证以后使用新密钥发布的版本，因此必须另行做好安全备份，且不能提交到 Git。

如果已发布版本的 `latest.json` 出现元数据错误，可手动运行 [Repair updater manifest](.github/workflows/repair-updater-manifest.yml) 并填写版本标签。该工作流只会依据现有签名资产重建、替换和匿名验证更新清单，不会重新构建安装包；只有明确勾选时才会将该版本设为最新版本。

## 凭据说明

“记住密码”开启时，连接信息会保存在 Tauri WebView 的 `localStorage` 中，以满足下次自动恢复连接的需求。密码不会写入源码、构建产物配置或 Rust 日志，但本地存储不是加密保险库，只应在可信设备上使用。连接设置提供“一键清除已保存凭据”。

## API 范围

实现依据录播姬 2.18.0 OpenAPI。Swagger 共声明 29 个操作；其中房间相关操作同时提供 `roomId` 和 `objectId` 两组等价路由：

- `GET /api/version`
- `GET /api/config/default`
- `GET /api/config/global`
- `POST /api/config/global`
- `GET /api/file`
- `GET /api/log/fetch`
- `POST /api/misc/generatefilename`
- `GET /api/room`
- `POST /api/room`
- `GET /api/room/{roomId|objectId}`
- `DELETE /api/room/{roomId|objectId}`
- `GET /api/room/{roomId|objectId}/stats`
- `GET /api/room/{roomId|objectId}/iostats`
- `GET /api/room/{roomId|objectId}/config`
- `POST /api/room/{roomId|objectId}/config`
- `POST /api/room/{roomId}/start`
- `POST /api/room/{roomId}/stop`
- `POST /api/room/{roomId}/split`
- `POST /api/room/{roomId}/refresh`
- `POST /api/room/{objectId}/start`
- `POST /api/room/{objectId}/stop`
- `POST /api/room/{objectId}/split`
- `POST /api/room/{objectId}/refresh`
- `GET /file/{path}`（由 MPV 读取，携带 Basic Auth）

录播姬 Swagger 还提及存在 GraphQL API，但没有在这份 OpenAPI 中声明 GraphQL schema，因此本项目的“完整覆盖”范围以 Swagger 的 29 个 REST 操作为准。
