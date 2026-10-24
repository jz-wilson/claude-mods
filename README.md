# claude-mods

Mods for Claude Code.

| Mod | What it does |
|---|---|
| [cache-bar](cache-bar) | Status-line bar under your existing status line showing how long the prompt cache stays warm, with a handoff countdown: `cache ▰▰▰▱▱▱▱▱ 23m 182k · handoff in 18m`. Turns yellow at a quarter of the TTL, red at the handoff threshold, and follows the drop to a 5-minute TTL. `/cache-bar:setup` installs it. |
| [filetree](filetree) | Fork of [data-goblin/claude-code-filetree](https://github.com/data-goblin/claude-code-filetree) that shows only the files Claude touched this session; the header's `◆` button toggles to the whole tree. |
| [helper-desk](helper-desk) | Task list above the prompt that follows Claude's to-do list, plus a side pane with one live card per subagent. |
| [helpin-per](helpin-per) | Pane listing open Helpin PER-* tasks; pick one to have Claude start working on it. |
| [cache-clock](cache-clock) | Countdown above the prompt until the chat's cache goes cold, with a Keep warm button. |
| [handoff](handoff) | When a chat gets very long, writes a handoff prompt and starts a fresh chat with it (`/refresh <focus>`; the handoff tells the new chat to run `/pickup`). |
| [reflect](reflect) | When you correct Claude, offers to save the fix as a lasting rule in `CLAUDE.md` or a rules folder. |
| [chat-inventory](chat-inventory) | Side pane, In this chat, listing the to-do list, connectors and calls per connector, files and skills this chat used. |
| [screen-share](screen-share) | `/screen-share` hides names, emails, phone numbers and money amounts on screen while you record. |
| [replay-theater](replay-theater) | `/replay` steps through the file edits Claude made in the last turn, one diff at a time. |
| [mods](mods) | `/mods` opens a pane to turn each mod on or off, including mods installed from other marketplaces, and to install mods a marketplace offers that are not installed yet. |
| [effort-optimizer](effort-optimizer) | Before Claude starts on a prompt, a quick Sonnet check picks the effort level it needs (Low to Max) and offers a one-click switch, or sets it by itself with `/effort-optimizer auto`. |
| [prompt-refiner](prompt-refiner) | A Refine button above the prompt, any time in the chat. Press it and pick a rewrite style for the prompt in the box, like a phone keyboard's suggestions: Clearer, Shorter, Elaborate, Brief (the job, the why, the guardrails, done means), Ask me first (up to 3 questions on gaps), or My guidance. The rewrite shows above the prompt with what changed; Use it fills the box, Refine runs another pass. `/refine <prompt>` does the same. |

The eight mods other than replay-theater, from helper-desk to effort-optimizer, come from Ben AI's benai-mods ([benai.co](https://www.benai.co)) and are redistributed with permission, with Windows fixes added here. replay-theater (one Ben AI change: `/mods` switch support) is Anthropic's sample mod from [anthropics/claude-code-playground](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/replay-theater), under the Apache 2.0 license in its `LICENSE`.

### Reflect setting

Reflect saves a rule either to `~/.claude/CLAUDE.md` (Save everywhere) or as its own note in a folder you choose (Save to vault). Set that folder as `rules_folder` when you install reflect, or later for reflect in `/config`. If it is empty, reflect asks for the folder the first time you press Save to vault.

## Install

At the prompt of a terminal session:

```
/plugin install helper-desk --marketplace jz-wilson/claude-mods
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install helper-desk --marketplace jz-wilson/claude-mods
claude plugin install cache-bar --marketplace jz-wilson/claude-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `jz-wilson/claude-mods`, then Add plugin.

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
