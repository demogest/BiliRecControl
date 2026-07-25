# BiliRec Control 便携包说明

便携 ZIP 适合解压后直接运行，但“便携”仅表示不需要执行传统安装程序：

- Windows 包内是独立的 `bilirec-control.exe`，系统仍需可用的 Microsoft Edge WebView2 Runtime。
- Linux 包内是 AppImage；首次运行前可能需要执行 `chmod +x`，部分发行版还需要 FUSE。
- macOS 包内是 `.app`，解压后可拖入“应用程序”目录或直接运行。
- 用户输入的 API 地址和凭据仍由系统 WebView 存储在当前用户的应用数据目录，不会存回 ZIP。
- 便携包不能保证应用内更新后仍保持原目录结构。长期使用建议安装对应系统安装包。

应用内更新包会经过 Tauri 签名校验。macOS 和 Windows 的操作系统级代码签名需要开发者证书；未签名构建首次运行时可能出现系统安全提示。
