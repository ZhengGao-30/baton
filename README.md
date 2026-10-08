# Baton

**English** · [简体中文](README.zh-CN.md)

**Use several of your own Claude accounts from one Claude Code window.**

Baton keeps your Claude Code work going across the Claude accounts you own. Your window's account is the *leader*: it plans and talks to you. Your other accounts are *workers*: the leader hands them the heavy jobs, so that work runs on their usage, and each worker remembers what it did. Baton also shows how much of each account's usage is left.

> Baton is an independent tool. It is not made by or affiliated with Anthropic; it works with Claude Code.

## Download

Get the files from the [latest GitHub Release](https://github.com/zhenggao-30/baton/releases/latest):

- **Baton-Setup.exe**: the Windows installer. It installs for your Windows user account and adds a Start menu shortcut.
- **Baton-portable.exe**: runs without installing.

The installer is not code-signed yet, so Windows SmartScreen may say "Windows protected your PC" or show an "unknown publisher". That is expected for an unsigned app. If you trust where you downloaded it, click **More info**, then **Run anyway**. Baton is open source, so anyone can read the code or build the files themselves (see [Build from source](#build-from-source)).

## Quick start

1. **Add your other accounts.** In the panel, add each Claude account you own and sign in to it once. Each one gets its own Claude Code login folder, separate from your main login.
2. **Connect.** Click **Connect**. Baton adds two hooks, one tool and one skill to Claude Code, and backs up your settings first.
3. **Open a new Claude Code session** (a session that was already open won't pick up the change) and say `/baton <job>`, or just say "use baton for this".
4. **Watch the panel.** It shows the job and its progress, and each account's usage.

## Screenshots

![The panel](docs/screenshots/overview.png)

![Accounts](docs/screenshots/accounts.png)

![Settings](docs/screenshots/settings.png)

## How it works

- **Leader and workers.** The account of the window you are in is the leader. When a job is handed off, a worker account runs the official Claude Code on it and hands back a report.
- **Threads and a ledger.** Workers can't see your conversation, so Baton gives them what they need: the dispatcher's written brief, a **named thread** per line of work (the same worker session is resumed each time, even if Baton had to move it to another account), and a **project ledger** of what every worker did. The ledger is added to the next worker's prompt, and the leader can read it with `baton_ledger`. Workers also get your shared `CLAUDE.md` files and project memory.
- **Usage at a glance.** The panel shows each account's 5-hour and weekly usage, read from Claude Code's own `/usage`, and when each one resets.
- **A model per account.** You can set a default model for each account's worker runs, such as `haiku` or a full model id. Leave it empty to use Claude Code's default.
- **The leader follows you.** The desktop app puts the signed-in e-mail in every session. When you switch this window to another account in the pool, Baton notices and updates who the leader is.
- **A safety net.** If the leader itself hits a limit in the middle of a task, Baton continues that same session on a worker in the background (with `--resume`) and tells you when it's done.
- **Parallel jobs, and queues.** Jobs on different accounts can run in parallel. Jobs for the same project folder wait in a queue, first come, first served, so two jobs never write to one folder at the same time.

## Privacy and safety

- **Credentials stay put.** Baton never reads, copies or sends your Claude credentials. Sign-in always goes through Claude Code's own flow (`claude auth login`), and each account's tokens stay inside that account's own Claude Code folder.
- **Local only.** Baton does not proxy API traffic and does not modify the Claude Code binary. The panel, its local API and the hooks all listen on `127.0.0.1`, and Baton sends nothing anywhere.
- **Exactly what Connect changes.** Two hooks in your Claude Code settings file (`StopFailure` for plan limits, `SessionStart` to learn who is signed in), an MCP server named `baton` registered with `claude mcp add --scope user`, and a skill in `~/.claude/skills/baton`. Your settings are backed up first, and only Baton's own entries are ever touched.
- **One-click undo.** Settings, then Danger zone, then *Remove Baton* takes out the hooks, the tool and the skill, and restores your settings. Your saved account sign-ins are kept, so setting Baton up again won't ask you to sign in. Tick the box if you also want the saved sign-ins, browser profiles and notes Baton made deleted; you would then have to sign in to each account again.
- **Uninstall.** The Windows uninstaller removes Baton's wiring from Claude Code automatically (the `baton` tool, the skill and the two hooks) and keeps your saved sign-ins.

## Good to know

- **Usage limits and terms still apply.** Anthropic describes Pro and Max limits as designed for ordinary individual use, and reserves the right to enforce its terms. Baton is meant for people who legitimately hold several accounts of their own (for example a personal and a work account). It doesn't change any account's limits, and each account keeps its own. You are responsible for using it within the [Consumer Terms](https://www.anthropic.com/legal/consumer-terms) and [Usage Policy](https://www.anthropic.com/legal/aup), and your organisation's terms if an account is a Team or Enterprise seat.
- **No shared logins.** Baton does not pool or share one login's usage. Each worker runs the official client under its own login.
- **Windows first.** Baton is built and tested on Windows 11. The macOS (`dmg`) and Linux (`AppImage`) targets are set up in the build config, but they have not been tested.
- **Not verified yet:**
  - A real plan-limit event. The failover path is tested with simulated limit events and with real accounts, but no real limit has happened to it yet.
  - Fresh PCs and older Windows. The installer and the uninstaller were run once, silently, on the machine they were built on (Windows 11); they have not been tried on a clean PC or on Windows 10.
  - Code signing. The files are unsigned (see [Download](#download)).

## Build from source

You need Node.js (CI uses Node 22). Then:

```bash
npm install
npm test                  # engine, takeover, hooks, workers, MCP protocol, connect/remove (fake `claude`)
node src/dev.js --demo    # the panel in a browser with throwaway demo accounts
npm start                 # the tray app
node src/cli.js           # terminal: add / login / list / connect / disconnect / remove-all
npm run dist              # Windows installer and portable exe, written to dist/
```

If `npm run dist` fails with `EPERM` when electron-builder renames a file, it often helps to build into a folder that sync tools and virus scanners don't watch, for example:

```bash
npm run dist -- -c.directories.output=C:/baton-build/dist
```

Where things are:

- `src/core`: the account store, limit detection and failover engine, usage reader, project memory (threads, ledger, locks), worker runner, and the hook and connect installers.
- `src/mcp.js`: the MCP server. `src/server.js`: the local API for the panel and the hooks.
- `ui/`: the panel. `src/main.js`: the Electron tray shell.
- `test/fake-claude.js` stands in for `claude`, so every test scenario runs without using any quota.

## Website

The project website is at <https://zhenggao-30.github.io/baton/>, with an overview of Baton, its illustrations and its diagrams.

## Contributing

Bug reports, feature ideas and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first. To report a security problem, use the private route in [SECURITY.md](SECURITY.md), not a public issue.

## License

[MIT](LICENSE). Copyright (c) 2026 ZhengGao-30.
