# 贡献与提交规范

本仓库的 Release Note 会由 `scripts/generate-changelog.mjs` 根据相邻版本标签之间的非合并提交自动生成。提交标题会直接出现在面向用户的 Changelog 中，因此所有进入 `main` 的非合并提交都必须遵循本规范。

## 提交标题

每个提交标题必须使用以下格式：

```text
<type>(<scope>)!: <description>
```

- `type`：必填，只能使用下表列出的类型。
- `scope`：可选，表示受影响的模块。
- `!`：可选，表示破坏性变更。
- `description`：必填，使用简洁、明确的英文描述。

严格匹配规则如下：

```regex
^(feat|fix|perf|refactor|docs|build|ci|chore|style|test|revert)(\([a-z0-9][a-z0-9-]*\))?!?: .+$
```

提交标题还必须满足：

- 总长度不超过 100 个字符。
- `type` 和 `scope` 使用小写字母；多单词 scope 使用短横线。
- 冒号后只有一个空格。
- `description` 使用现在时或祈使语气，例如 `add`、`fix`、`update`、`remove`。
- `description` 不以句号或中文句号结尾。
- 不使用 `update stuff`、`fix bug`、`misc changes` 等无法独立说明变更的描述。
- `[skip ci]` 等 CI 指令如确有需要，应放在提交正文，不应污染标题和 Changelog。

## 类型与 Changelog 分组

| type       | 使用场景                         | Changelog 分组 |
| ---------- | -------------------------------- | -------------- |
| `feat`     | 新增面向用户的功能或能力         | ✨ 新功能      |
| `fix`      | 修复缺陷、错误行为或兼容性问题   | 🐛 问题修复    |
| `perf`     | 不改变行为的性能优化             | ⚡ 性能优化    |
| `refactor` | 不新增功能、不修复缺陷的代码重构 | ♻️ 重构        |
| `docs`     | 仅修改文档                       | 📝 文档        |
| `build`    | 构建系统、打包或工具链调整       | 🛠 工程维护     |
| `ci`       | GitHub Actions 等持续集成调整    | 🛠 工程维护     |
| `chore`    | 版本、依赖和其他日常维护         | 🛠 工程维护     |
| `style`    | 不影响逻辑的格式或样式整理       | 🛠 工程维护     |
| `test`     | 新增或调整测试                   | 🛠 工程维护     |
| `revert`   | 撤销一个已有变更                 | 🛠 工程维护     |

任一允许类型带有 `!` 时，都会优先进入 `⚠️ 破坏性变更` 分组。

不要自行创造 `feature`、`bugfix`、`hotfix`、`release`、`security` 或 `deps` 等 type。应改用允许的类型和 scope，例如：

```text
fix(security): reject invalid updater signatures
chore(deps): update Tauri dependencies
chore(release): bump version to 1.4.10
```

## Scope

Scope 应稳定描述代码边界，而不是临时任务名称。常用 scope 包括：

| scope       | 适用范围               |
| ----------- | ---------------------- |
| `dashboard` | 大屏总览和房间矩阵     |
| `library`   | 录制资料库和历史文件   |
| `config`    | 全局或房间录制设置     |
| `api`       | 前后端 API 模型和请求  |
| `tauri`     | Rust/Tauri 桌面端能力  |
| `updater`   | 应用内更新和更新清单   |
| `release`   | 版本号、标签和发布流程 |
| `ci`        | GitHub Actions 工作流  |
| `deps`      | 依赖升级               |
| `docs`      | 文档组织               |

没有清晰模块边界时可以省略 scope，不应使用 `misc`、`other` 或工单编号充当 scope。

## 示例

合规提交：

```text
feat(library): add room sorting by recent activity
fix(updater): rebuild the complete updater manifest
perf(history): reduce allocations while scanning files
refactor(api): centralize authenticated requests
docs: define the commit message convention
ci(release): serialize signed package publishing
chore(release): bump version to 1.4.10
feat(api)!: remove the legacy room endpoint
```

不合规提交：

```text
Add recording sorting and session metrics
update UI
feature(library): add sorting
fix(Library): correct ordering
feat:added sorting
fix: fix bug.
WIP
```

## 破坏性变更

破坏性变更必须在标题的冒号前添加 `!`，并在提交正文中说明迁移方式：

```text
feat(api)!: remove the legacy room endpoint

BREAKING CHANGE: integrations must use /api/room/{roomId}.
```

只有正文中的 `BREAKING CHANGE` 而标题没有 `!` 时，当前 Changelog 脚本不会把该提交归入破坏性变更。

## 提交边界

- 一个提交只表达一个可独立解释的逻辑变更。
- 实现、对应测试和必要文档可以属于同一提交。
- 无关格式化、依赖升级和功能修改应拆分提交。
- 不允许把 `WIP`、`fixup!`、`squash!` 或临时调试提交直接带入 `main` 或版本标签。
- 使用 Squash Merge 时，Pull Request 的最终提交标题也必须符合本规范。
- 普通 merge commit 不会进入 Changelog，但不能依赖 merge commit 掩盖不合规的 squash 或直接提交。
- 使用 `git revert` 后必须把默认的 `Revert "..."` 标题改写为 `revert(<scope>): <description>`。

## 发布提交

正式发布前，`package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 的版本必须一致。仅升级版本号时使用独立提交：

```text
chore(release): bump version to 1.4.10
```

版本标签使用对应的 `v<version>`，例如 `v1.4.10`。标签本身不替代符合规范的提交标题。

`main` 推送包含 `feat`、`fix`、`perf`、`refactor`、`build`、`revert` 或 `chore(deps)` 提交且 CI 成功时，会自动创建下一补丁版本的测试标签，例如 `v1.4.10-beta.123.1`。仅包含 `docs`、`ci`、`style`、`test` 或其他 `chore` 的推送不会创建测试版；需要验证这类工程变更的实际打包结果时，可以手动运行工作流。这些测试标签和 `ci-latest` 滚动通道由工作流维护，不应手动创建、移动或用于正式发布；正式 Changelog 查找起点时只识别 `v<major>.<minor>.<patch>` 稳定标签，避免测试标签截断正式版本的变更记录。

## 本地检查

格式化前端、配置、文档和 Rust 代码：

```powershell
npm run format
```

运行与 CI 相同的完整检查：

```powershell
npm run check
```

预览从最近版本标签到当前 `HEAD` 的 Changelog：

```powershell
npm run changelog
```

只检查提交标题是否合规：

```powershell
npm run changelog:check
```

正式发布工作流会执行同样的严格检查。任何不合规的非合并提交都会中止发布，需要先整理提交历史并重新创建版本标签。
