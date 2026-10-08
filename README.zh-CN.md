# Baton

[English](README.md) · **简体中文**

**一个 Claude Code 窗口，调用你自己拥有的几个 Claude 账号。**

Baton 让你在 Claude Code 里的工作，可以分给你拥有的几个 Claude 账号一起完成。当前窗口的账号是*领队*：它负责规划，并和你对话。其余账号是*工作账号*：领队把重活交给它们，这些活就用它们的额度来跑，每个工作账号也会记住自己做过什么。Baton 还会显示每个账号的额度还剩多少。

> Baton 是一个独立的工具，不是 Anthropic 制作的，也与 Anthropic 没有隶属关系；它与 Claude Code 配合使用。

## 下载

从 [最新的 GitHub Release](https://github.com/zhenggao-30/baton/releases/latest) 下载：

- **Baton-Setup.exe**：Windows 安装程序，装在当前 Windows 用户下，并会在开始菜单里放一个快捷方式。
- **Baton-portable.exe**：免安装，直接运行。

安装程序目前还没有代码签名，所以 Windows SmartScreen 可能会提示"Windows 已保护你的电脑"，或者显示发布者为"未知发布者"。对于没有签名的应用，这是正常现象。如果你信任下载来源，点击 **更多信息**，再点 **仍要运行**。Baton 是开源的，任何人都可以阅读代码，或者自己从源码构建（见下方 [从源码构建](#从源码构建)）。

## 快速开始

1. **添加你的其他账号。** 在面板里添加你拥有的每一个 Claude 账号，并各登录一次。每个账号都有自己单独的 Claude Code 登录文件夹，和你平时的登录互不影响。
2. **点击"连接"。** Baton 会向 Claude Code 添加两个钩子、一个工具和一个技能，并且会先备份你的设置。
3. **打开一个新的 Claude Code 会话**（已经打开的会话不会自动生效），然后输入 `/baton <任务>`，或者直接说"用 baton 来做这个"。
4. **看面板。** 面板会显示任务和进度，以及每个账号的额度。

## 截图

![面板](docs/screenshots/overview.png)

![账号](docs/screenshots/accounts.png)

![设置](docs/screenshots/settings.png)

## 工作原理

- **领队与工作账号。** 你所在窗口的账号就是领队。任务交出去之后，由某个工作账号运行官方的 Claude Code 来完成，再把报告交回来。
- **线程与账本。** 工作账号看不到你的对话，所以 Baton 会把它需要的东西交给它：调度方写的任务说明；每条工作线路对应一个**命名线程**（同一个工作会话每次都会接着之前的继续，即使 Baton 不得不把它换到另一个账号上）；以及一份**项目账本**，记录每个工作账号做过什么。账本会加入下一个工作账号的提示词里，领队也可以通过 `baton_ledger` 读取它。工作账号还能读到你共享的 `CLAUDE.md` 文件和项目记忆。
- **一眼看清额度。** 面板显示每个账号的 5 小时额度和每周额度，数据来自 Claude Code 自己的 `/usage`，并显示每项额度什么时候重置。
- **每个账号单独选模型。** 你可以为每个账号的工作任务设置默认模型，比如 `haiku`，或完整的模型 ID。留空则使用 Claude Code 的默认模型。
- **领队跟着你走。** 桌面版应用会在每个会话里带上登录的邮箱。你把这个窗口切换到账号池里的另一个账号时，Baton 会发现这一变化，并更新领队是谁。
- **安全网。** 如果领队自己在任务中途碰到额度上限，Baton 会在后台把同一个会话交给某个工作账号接着做（使用 `--resume`），完成后通知你。
- **并行与排队。** 不同账号上的任务可以同时进行。需要同一个项目文件夹的任务会排队，先来先做，因此两个任务不会同时写同一个文件夹。

## 隐私与安全

- **凭据不经手。** Baton 从不读取、复制或发送你的 Claude 凭据。登录始终走 Claude Code 自己的流程（`claude auth login`），每个账号的令牌都留在该账号自己的 Claude Code 文件夹里。
- **只在本机运行。** Baton 不转发 API 流量，也不修改 Claude Code 本身。面板、它的本地接口和钩子都只监听 `127.0.0.1`，Baton 不会把任何内容发到别处。
- **"连接"具体改了什么。** 你的 Claude Code 设置文件里多两个钩子（`StopFailure` 用于处理套餐额度用尽，`SessionStart` 用于得知当前登录的是谁）；用 `claude mcp add --scope user` 注册一个名为 `baton` 的 MCP 服务；在 `~/.claude/skills/baton` 放一个技能。改动前会先备份你的设置，而且只动 Baton 自己添加的条目。
- **一键撤销。** 进入设置，找到"危险操作"区域，点击 *Remove Baton*，就会移除钩子、工具和技能，并恢复你的设置。已保存的账号登录会被保留，所以重新设置 Baton 时不必再登录一遍。如果你也想删掉已保存的登录、浏览器配置和 Baton 生成的文件，就勾选对应的选项；这样之后每个账号都要重新登录。

## 需要知道的事

- **额度限制和使用条款依然适用。** Anthropic 说明 Pro 和 Max 的额度是为普通个人使用设计的，并保留执行其条款的权利。Baton 面向的是合法拥有多个账号的人（比如个人账号和工作账号）。它不会改变任何账号的额度，每个账号仍保有自己的额度。你需要遵守 [Consumer Terms](https://www.anthropic.com/legal/consumer-terms) 和 [Usage Policy](https://www.anthropic.com/legal/aup)；如果某个账号是 Team 或 Enterprise 席位，还要遵守你所在机构的条款。
- **不共享登录。** Baton 不会把一个登录的额度汇集或共享出去。每个工作账号都用自己的登录运行官方客户端。
- **以 Windows 为先。** Baton 在 Windows 11 上构建和测试。macOS（`dmg`）和 Linux（`AppImage`）的打包配置已经写好，但还没有测试过。
- **尚未验证的内容：**
  - 真正遇到一次套餐额度上限。故障转移的路径已经用模拟的额度事件和真实账号测试过，但还没有真正碰到过额度上限。
  - 全新的电脑和较旧的 Windows。安装程序和卸载程序只在构建它们的那台电脑（Windows 11）上静默运行过一次，没有在干净的电脑或 Windows 10 上试过。
  - 代码签名。这些文件没有签名（见[下载](#下载)）。

## 从源码构建

你需要 Node.js（CI 使用 Node 22）。然后运行：

```bash
npm install
npm test                  # 引擎、接管、钩子、工作账号、MCP 协议、连接/移除（使用假的 `claude`）
node src/dev.js --demo    # 在浏览器里打开面板，使用一次性的演示账号
npm start                 # 托盘应用
node src/cli.js           # 终端命令：add / login / list / connect / disconnect / remove-all
npm run dist              # Windows 安装程序和免安装版，输出到 dist/
```

如果 `npm run dist` 在 electron-builder 重命名文件时报 `EPERM` 错误，通常可以把输出目录换到不会被同步工具或杀毒软件监视的文件夹，例如：

```bash
npm run dist -- -c.directories.output=C:/baton-build/dist
```

各部分的位置：

- `src/core`：账号存储、额度检测和故障转移引擎、用量读取、项目记忆（线程、账本、锁）、工作账号运行器，以及钩子和连接的安装程序。
- `src/mcp.js`：MCP 服务。`src/server.js`：面板和钩子使用的本地接口。
- `ui/`：面板。`src/main.js`：Electron 托盘外壳。
- `test/fake-claude.js` 代替 `claude` 运行，所以每个测试场景都不消耗额度。

## 网站

项目网站：<https://zhenggao-30.github.io/baton/>，里面有 Baton 的概览、插图和示意图。

## 参与贡献

欢迎提交问题报告、功能建议和 Pull Request。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。如果你发现安全问题，请按 [SECURITY.md](SECURITY.md) 中的私密渠道报告，不要公开提交 issue。所有帮助过这个项目的人都列在 [CONTRIBUTORS.md](CONTRIBUTORS.md) 里。

## 许可证

[MIT](LICENSE)。版权所有 (c) 2026 ZhengGao-30。
