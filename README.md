# claude-mods

Mods for Claude Code.

| Mod | What it does |
|---|---|
| [agent-tree](agent-tree) | Live pane showing the subagent spawn tree as cards: who spawned whom, model, status, task, cost, elapsed time and recent tools. Flags Fable running as a worker and subagents idle for 2 minutes. `/agent-tree` toggles the pane. |
| [cache-bar](cache-bar) | Status-line bar under your existing status line showing how long the prompt cache stays warm, with a handoff countdown: `cache ▰▰▰▱▱▱▱▱ 23m 182k · handoff in 18m`. Turns yellow at a quarter of the TTL, red at the handoff threshold, and follows the drop to a 5-minute TTL. `/cache-bar:setup` installs it. |
| [filetree](filetree) | Fork of [data-goblin/claude-code-filetree](https://github.com/data-goblin/claude-code-filetree) that shows only the files Claude touched this session; the header's `◆` button toggles to the whole tree. |

## Install

At the prompt of a terminal session:

```
/plugin install agent-tree --marketplace jz-wilson/claude-mods
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install agent-tree --marketplace jz-wilson/claude-mods
claude plugin install cache-bar --marketplace jz-wilson/claude-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `jz-wilson/claude-mods`, then Add plugin.

## agent-tree and claude-hud

If [claude-hud](https://github.com/jarrodwatts/claude-hud) is installed, agent-tree turns off its `display.showAgents` while the Agents pane is on screen and restores the earlier value when the pane closes or the session ends.

## cache-bar and claude-hud

cache-bar is a status-line script, so it takes over `statusLine` and runs the previous status line inside it. After installing, run `/cache-bar:setup`. It:

- backs up `settings.json` to `settings.json.bak-cache-bar`;
- moves the current `statusLine.command` (claude-hud's, for example) into `inner` in `~/.claude/plugins/cache-bar/config.json`;
- points `statusLine.command` at the newest installed cache-bar version, and sets `refreshInterval: 60` so the countdown repaints while you are idle.

The previous status line prints first, unchanged, and the bar goes on its own line underneath. If the inner command fails, the bar still prints. Before the first request of a session there is no cache yet, so the bar is hidden; after expiry it shows a dim `cold`.

The same config file sets the handoff threshold and the context floor:

```json
{ "inner": "…", "handoffMinutes": 5, "floorTokens": 80000 }
```

The threshold is capped at a fifth of the TTL, so it fits the 5-minute TTL too. Under `floorTokens` of context the bar says `no handoff (<floor)`.

To undo, copy `settings.json.bak-cache-bar` back over `settings.json`, or set `statusLine.command` back to the `inner` value.

## Development

Each mod is a folder with `.claude-plugin/plugin.json`. CI runs `claude plugin validate` on every mod for each push and pull request, then `claude plugin test` for mods with a hooks module and `bun test` for the rest. A merge to `main` that bumps a mod's `version` publishes a GitHub release tagged `<mod>-v<version>`.

```
claude plugin validate agent-tree
claude plugin test agent-tree
bun test cache-bar
```
