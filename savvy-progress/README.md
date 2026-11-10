# savvy-progress

A Claude Code mod: a progress bar above the prompt and a live panel of subagents. Made for the savvy-flow skill, and useful with any subagents.

This is a fork of [johnnyvizz/claude-kit's savvy-progress](https://github.com/johnnyvizz/claude-kit/tree/main/plugins/savvy-progress) 1.2.1, under its MIT license (see `LICENSE`). The change here is the terminal panel: upstream draws the crabs only in the desktop app, and the terminal got plain text rows. In this fork each agent in the terminal panel is a card with its pixel crab in costume, drawn with half-block characters from the same sprites (`hooks/sprite.ts`), and the totals sit in three tiles above the list. A running agent's crab steps once a second; a finished one is greyed back. The `crabs` setting turns the walk or the crabs off. A panel narrower than 44 columns keeps the text rows and drops the crab.

- **Progress bar**: the flow's title, phase, accepted tasks out of planned, and a button with the crew size that opens the panel. It appears once something reports progress (savvy-flow does) or a `savvy-*` worker starts.
- **Agents panel** (`/agents-info` toggles it; `/agents-info open` opens it or brings it forward without toggling): running, finished and planned subagents with model, effort, task progress, context, estimated cost and time. Working crabs walk, and each savvy tier animates its prop: the astronaut floats, the detective sweeps the magnifier, the engineer turns the wrench, the chef tosses the omelette, the racer runs with a fluttering flag. `prefers-reduced-motion` stops them.

## Tools it adds

- `mcp__savvy-progress__progress`: the orchestrator reports the plan, phase and accepted tasks. Only the main session can: a call from a subagent is ignored, so a worker cannot rename, finish or reset the flow.
- `mcp__savvy-progress__step`: a worker reports its own steps (`done`, `total`, `note`). A worker that does not report shows its context fill in grey instead. The tool is listed up front rather than behind ToolSearch, and each `savvy-*` worker gets one line at the end of its brief asking for these reports.

Cost is a rough estimate from token counts and a built-in per-model price table (`PRICES` in `hooks/register.tsx`, list prices as of 2026-10-10), not a bill. Cache writes are priced at the 1-hour rate, which is what Claude Code writes on a subscription; a session that writes 5-minute entries is overestimated there.

## Settings

`language`: `auto` (default), `en`, `ru` or `he`. Hebrew draws the bar and the panel right to left. `auto` follows Claude Code's `language` setting, then the system locale, and falls back to English. Set it in `/config`, or, for a mod loaded by hand, in `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "savvy-progress": { "options": { "language": "ru" } } } }
```

`autoOpen`: `savvy` (default) or `any`. With `savvy` the panel opens by itself when a `savvy-*` worker starts or a plan is reported. With `any` it also opens, once per session, when any other subagent starts. `/agents-info` toggles it either way.

`crabs`: `walk` (default), `still` or `off`, for the terminal panel. `walk` steps each running agent's crab; `still` draws the crabs without motion; `off` shows a coloured mark instead.

Install instructions are in the [repository README](../README.md). Install this fork or upstream's `savvy-progress@claude-kit`, not both: they share a name, tools and state.
