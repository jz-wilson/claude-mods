// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0
//
// Replay Theater: records the file edits Claude makes in a turn, then lets you
// step through them in a pane, one diff at a time.
//
// Claude Code 2.1.280 function hooks. Load with --plugin-dir.
//
// Changed by Ben AI (2026-10): added the /mods switchboard support below
// (turn off and hide via ~/.claude/mods/switches.json).
// Changed by jz-wilson (2026-11): the pane leads with a summary ("3 edits in 1 file",
// lines added and removed) and lists the edits in order with the viewed ones checked;
// off the terminal that view is one SVG card. The buttons read Previous edit / Next edit.
// The recording and the diff are Anthropic's original.

const PANE_ID = "replay-theater";
const MAX_DIFF_LINES = 12;
// The most edits the list shows at once; a longer replay scrolls a window around the current one.
const LIST_MAX = 6;
const MAX_LCS_LINES = 400;
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

// Module state. `pending` fills during a turn; `replay` is the last finished
// turn's steps, the ones the pane shows.
const state = { pending: [], replay: [], index: 0, isOpen: false, inBand: false, turns: 0 };

// The /mods switchboard turns this mod off in every chat with switches.json.
// "replay-theater:hidden": true in the same file hides the hint band and closes the pane.
const NAME = "replay-theater";
const HIDE_KEY = `${NAME}:hidden`;
const POLL_MS = 3000;
const sw = { off: false, hidden: false, sid: "" };

const homeOf = ($) => $.plugin.root.replace(/\\/g, "/").split("/.claude/")[0] || "";
const switchesPath = ($) => `${homeOf($)}/.claude/mods/switches.json`;

async function readSwitches($) {
  const path = switchesPath($);
  if (!(await $.fs.exists(path))) return {};
  const json = JSON.parse(String(await $.fs.read(path)));
  return json && typeof json === "object" && !Array.isArray(json) ? json : {};
}

async function readSwitch($) {
  let nowOff = sw.off, nowHidden = sw.hidden;
  try {
    const json = await readSwitches($);
    nowOff = json[NAME] === false;
    nowHidden = json[HIDE_KEY] === true;
  } catch { /* a broken or missing file changes nothing */ }
  if (nowOff === sw.off && nowHidden === sw.hidden) return;
  const closing = (nowOff && !sw.off) || (nowHidden && !sw.hidden);
  sw.off = nowOff;
  sw.hidden = nowHidden;
  if (closing && state.isOpen) {
    state.isOpen = false;
    state.inBand = false;
    await Promise.resolve($.ui.close({ id: PANE_ID })).catch(() => undefined);
  }
  $.ui.invalidate("ui.render");
}

// Read, change, write the whole file, so every chat sees the choice within 3 s.
async function setHidden($, value) {
  try {
    const json = await readSwitches($).catch(() => ({}));
    if (value) json[HIDE_KEY] = true;
    else delete json[HIDE_KEY];
    await $.fs.write(switchesPath($), `${JSON.stringify(json, null, 2)}\n`);
  } catch { /* the in-memory flag still changes */ }
  sw.hidden = value;
}

// $.fs has no delete, and Windows has no rm outside Git Bash: del through cmd there.
async function removeFile($, path) {
  const windows = (await $.env.get("OS")) === "Windows_NT";
  await $.process.run(windows ? ["cmd", "/c", "del", "/f", "/q", path.replace(/\//g, "\\")] : ["rm", "-f", path]);
}

// The /mods switchboard asks for the pane by leaving an empty file for this chat.
async function checkOpen($) {
  if (!sw.sid) return;
  const path = `${homeOf($)}/.claude/mods/.open-${NAME}-${sw.sid}`;
  try {
    if (!(await $.fs.exists(path))) return;
    await removeFile($, path);
    if (sw.off) return;
    const opened = await openReplay($);
    if (!opened) $.ui.toast("Replay Theater: no edits in the last turn yet.");
  } catch { /* try again on the next poll */ }
}

async function poll($) {
  await readSwitch($);
  await checkOpen($);
}

function relPath(cwd, path) {
  if (!path) return "(unknown file)";
  if (cwd && path.startsWith(cwd + "/")) return path.slice(cwd.length + 1);
  return path;
}

function splitLines(text) {
  if (text === undefined || text === null || text === "") return [];
  const lines = String(text).split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

// A line diff. Small inputs get an LCS diff, so unchanged lines show as
// context; large ones fall back to all-removed then all-added.
function diffLines(oldText, newText) {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  if (a.length > MAX_LCS_LINES || b.length > MAX_LCS_LINES) {
    return [...a.map((t) => ({ op: "-", t })), ...b.map((t) => ({ op: "+", t }))];
  }
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ op: " ", t: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ op: "-", t: a[i++] });
    else out.push({ op: "+", t: b[j++] });
  }
  while (i < n) out.push({ op: "-", t: a[i++] });
  while (j < m) out.push({ op: "+", t: b[j++] });
  return trimContext(out);
}

// Keep one line of context around each change, so a long file's Write shows
// the changed lines, not the whole file.
function trimContext(lines) {
  if (!lines.some((l) => l.op !== " ")) return lines.slice(0, MAX_DIFF_LINES);
  const keep = lines.map((l, k) =>
    l.op !== " " || lines[k - 1]?.op && lines[k - 1].op !== " " || lines[k + 1]?.op && lines[k + 1].op !== " ");
  const out = [];
  let skipped = false;
  lines.forEach((l, k) => {
    if (keep[k]) { if (skipped && out.length) out.push({ op: "~", t: "⋯" }); out.push(l); skipped = false; }
    else skipped = true;
  });
  return out;
}

function countChanges(diff) {
  let add = 0, del = 0;
  for (const l of diff) { if (l.op === "+") add++; else if (l.op === "-") del++; }
  return { add, del };
}

// Turns one tool call into one or more steps.
async function stepsFor($, e) {
  let cwd = "";
  try { cwd = await $.session.cwd(); } catch { /* keep the full path */ }
  const file = relPath(cwd, e.file_path);
  if (e.tool === "Edit") {
    return [{ tool: "Edit", file, diff: diffLines(e.old_string, e.new_string), note: e.replace_all ? "replace all" : "" }];
  }
  if (e.tool === "MultiEdit" && Array.isArray(e.edits)) {
    return e.edits.map((ed, k) => ({
      tool: "MultiEdit", file, diff: diffLines(ed.old_string, ed.new_string), note: `edit ${k + 1} of ${e.edits.length}`,
    }));
  }
  if (e.tool === "Write") {
    let before = "";
    let isNew = true;
    try {
      if (e.file_path && (await $.fs.exists(e.file_path))) {
        before = await $.fs.read(e.file_path);
        isNew = false;
      }
    } catch { /* unreadable: show it as a new file */ }
    return [{ tool: "Write", file, diff: diffLines(before, e.content), note: isNew ? "new file" : "rewrite" }];
  }
  return [];
}

function hintText() {
  const n = state.replay.length;
  return `▶ Replay: ${n} edit${n === 1 ? "" : "s"} (press r)`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// What the whole replay comes to: the summary line over the list.
export function totals(steps) {
  let add = 0, del = 0;
  for (const s of steps) { const c = countChanges(s.diff); add += c.add; del += c.del; }
  return { edits: steps.length, files: new Set(steps.map((s) => s.file)).size, add, del };
}

// The slice of the edit list to show: all of it when it fits, else LIST_MAX rows that keep
// the current edit in view.
export function listWindow(total, k) {
  if (total <= LIST_MAX) return { from: 0, to: total };
  const from = Math.max(0, Math.min(k - Math.floor(LIST_MAX / 2), total - LIST_MAX));
  return { from, to: from + LIST_MAX };
}

const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

// File names and diff lines come from the project, so everything put into markup is escaped,
// and the control characters XML refuses are dropped.
const xml = (s) => String(s)
  .replace(/\t/g, "  ")
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
  // A surrogate without its pair is not a character XML allows.
  .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "")
  .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// How many narrow-glyph widths a character takes: CJK, full-width forms and emoji take two.
const wide = (ch) => (ch.codePointAt(0) >= 0x2e80 ? 2 : 1);

// Cuts a string to what fits `px` at a font size; `fromStart` keeps the end (a path's file name).
// It cuts between whole characters, never inside a surrogate pair.
function fit(s, px, size, fromStart = false) {
  const max = Math.max(4, Math.floor(px / (size * 0.6)));
  const chars = Array.from(String(s));
  if (chars.reduce((n, ch) => n + wide(ch), 0) <= max) return chars.join("");
  if (fromStart) chars.reverse();
  const kept = [];
  let used = 1; // the ellipsis
  for (const ch of chars) {
    if (used + wide(ch) > max) break;
    kept.push(ch);
    used += wide(ch);
  }
  return fromStart ? `…${kept.reverse().join("")}` : `${kept.join("")}…`;
}

// The replay as one SVG card, for the surfaces that draw one (desktop, VS Code, mobile):
// the summary, the edits in order, and the current edit's diff. It paints its own background
// in light and dark, and the diff fades in once per step unless reduced motion is asked for.
export function replaySvg(steps, index, W) {
  const total = steps.length;
  if (!total) {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="48" viewBox="0 0 ${W} 48"><style>.card{fill:#f7f6f2}.s{fill:#75736c}@media (prefers-color-scheme: dark){.card{fill:#262624}.s{fill:#a3a199}}</style><rect class="card" width="${W}" height="48" rx="12"/><text class="s" x="16" y="29" font-family="${FONT}" font-size="13">No edits to replay.</text></svg>`;
    return { source, height: 48, alt: "No edits to replay." };
  }
  const k = Number.isFinite(index) ? Math.max(0, Math.min(Math.trunc(index), total - 1)) : 0;
  const step = steps[k];
  const t = totals(steps);
  const P = 16;
  const inner = W - P * 2;
  const out = [];
  let y = 0;

  out.push(`<text class="t" x="${P}" y="${y + 28}" font-family="${FONT}" font-size="16" font-weight="700">${xml(`${plural(t.edits, "edit")} in ${plural(t.files, "file")}`)}</text>`);
  out.push(`<text x="${P}" y="${y + 48}" font-family="${FONT}" font-size="12"><tspan class="add">${plural(t.add, "line")} added</tspan><tspan class="s">, </tspan><tspan class="del">${t.del} removed</tspan></text>`);
  y += 62;

  out.push(`<text class="s" x="${P}" y="${y + 12}" font-family="${FONT}" font-size="10.5" font-weight="600" letter-spacing="1">THE EDITS, IN ORDER</text>`);
  y += 20;
  const win = listWindow(total, k);
  for (let n = win.from; n < win.to; n++) {
    const c = countChanges(steps[n].diff);
    const mid = y + 14;
    if (n === k) out.push(`<rect class="cur" x="${P - 6}" y="${y + 1}" width="${inner + 12}" height="26" rx="7"/>`);
    if (n < k) out.push(`<circle class="okc" cx="${P + 9}" cy="${mid}" r="8.5"/><path class="okm" d="M${P + 5} ${mid}l3 3 5-6" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`);
    else out.push(`<circle class="${n === k ? "curc" : "todo"}" cx="${P + 9}" cy="${mid}" r="8.5"/><text class="${n === k ? "curn" : "s"}" x="${P + 9}" y="${mid + 3.5}" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="700">${n + 1}</text>`);
    out.push(`<text class="t" x="${P + 28}" y="${mid + 4.5}" font-family="${FONT}" font-size="13">${xml(fit(steps[n].file, inner - 28 - 70, 13, true))}</text>`);
    out.push(`<text x="${W - P}" y="${mid + 4}" text-anchor="end" font-family="${MONO}" font-size="11"><tspan class="add">+${c.add}</tspan><tspan class="del"> -${c.del}</tspan></text>`);
    y += 28;
  }
  if (total > LIST_MAX) {
    out.push(`<text class="s" x="${P + 28}" y="${y + 13}" font-family="${FONT}" font-size="11">${win.from + 1} to ${win.to} of ${total}</text>`);
    y += 20;
  }
  y += 10;

  out.push(`<text class="acc" x="${P}" y="${y + 12}" font-family="${FONT}" font-size="10.5" font-weight="700" letter-spacing="1">EDIT ${k + 1} OF ${total}</text>`);
  y += 22;
  const meta = `${step.tool}${step.note ? ` · ${step.note}` : ""}`;
  // The tool and note take at most 45% of the row, the file name the rest less a gap.
  const metaShown = fit(meta, inner * 0.45, 11);
  const metaW = Array.from(metaShown).length * 11 * 0.6;
  out.push(`<text class="t" x="${P}" y="${y + 14}" font-family="${FONT}" font-size="14" font-weight="700">${xml(fit(step.file, inner - metaW - 12, 14, true))}</text>`);
  out.push(`<text class="s" x="${W - P}" y="${y + 14}" text-anchor="end" font-family="${FONT}" font-size="11">${xml(metaShown)}</text>`);
  y += 26;

  const shown = step.diff.slice(0, MAX_DIFF_LINES);
  const more = step.diff.length - shown.length;
  const rows = Math.max(1, shown.length) + (more > 0 ? 1 : 0);
  const LH = 20;
  const boxH = rows * LH + 12;
  const diff = [];
  let dy = y + 6;
  if (!shown.length) diff.push(`<text class="s" x="${P + 12}" y="${dy + 14}" font-family="${FONT}" font-size="12">no line changes</text>`);
  for (const l of shown) {
    const cls = l.op === "+" ? "add" : l.op === "-" ? "del" : "s";
    if (l.op === "+" || l.op === "-") diff.push(`<rect class="${cls}bg" x="${P}" y="${dy}" width="${inner}" height="${LH}"/>`);
    diff.push(`<text class="${cls === "s" ? "s" : "dt"}" x="${P + 12}" y="${dy + 14}" font-family="${MONO}" font-size="12" xml:space="preserve"><tspan class="${cls}">${l.op === "~" ? " " : xml(l.op)}</tspan> ${xml(fit(l.t, inner - 44, 12))}</text>`);
    dy += LH;
  }
  if (more > 0) diff.push(`<text class="s" x="${P + 12}" y="${dy + 14}" font-family="${FONT}" font-size="11">${plural(more, "more line")}</text>`);
  out.push(`<clipPath id="d"><rect x="${P}" y="${y}" width="${inner}" height="${boxH}" rx="8"/></clipPath>`);
  out.push(`<g class="in" clip-path="url(#d)"><rect class="code" x="${P}" y="${y}" width="${inner}" height="${boxH}"/>${diff.join("")}</g>`);
  y += boxH + P;

  const H = y;
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>
.card{fill:#f7f6f2}.t{fill:#1f1e1d}.s{fill:#75736c}.code{fill:#ecebe6}.dt{fill:#1f1e1d}
.add{fill:#1a7f4b}.del{fill:#b3382c}.addbg{fill:#1a7f4b;opacity:.14}.delbg{fill:#b3382c;opacity:.12}
.acc{fill:#b83280}.cur{fill:#b83280;opacity:.12}.curc{fill:#d6409f}.curn{fill:#ffffff}
.okc{fill:#1a7f4b}.okm{stroke:#ffffff}.todo{fill:none;stroke:#a8a69e;stroke-width:1.2}
@media (prefers-color-scheme: dark){
.card{fill:#262624}.t{fill:#f3f2ee}.s{fill:#a3a199}.code{fill:#1b1b19}.dt{fill:#f3f2ee}
.add{fill:#5fd39a}.del{fill:#f08a7e}.addbg{fill:#2f9e68;opacity:.28}.delbg{fill:#c2493c;opacity:.26}
.acc{fill:#f28cc4}.cur{fill:#d6409f;opacity:.22}.okc{fill:#2f9e68}.todo{stroke:#6f6d66}
}
.in{animation:in .22s ease-out}
@keyframes in{from{opacity:0;transform:translateY(4px)}}
@media (prefers-reduced-motion: reduce){.in{animation:none}}
</style>
<rect class="card" width="${W}" height="${H}" rx="12"/>
${out.join("\n")}
</svg>`;
  const alt = `${plural(t.edits, "edit")} in ${plural(t.files, "file")}, ${t.add} lines added, ${t.del} removed. Edit ${k + 1} of ${total}: ${step.file}, ${meta}, +${countChanges(step.diff).add} -${countChanges(step.diff).del}.`;
  return { source, height: H, alt };
}

async function openReplay($) {
  if (!state.replay.length) return false;
  state.index = 0;
  state.isOpen = true;
  // The pane only takes the keyboard while nothing else holds it. Hide the
  // band first (it held the keys if its button was pressed), then open.
  $.ui.invalidate("ui.render");
  await $.clock.sleep(200);
  // Border (2), summary (2), two labels, the list and its "k to m of N" row, file and meta,
  // the diff with its margin and "more lines" row (MAX_DIFF_LINES + 2), buttons (2) and the hint.
  const n = state.replay.length;
  const rows = MAX_DIFF_LINES + 13 + Math.min(n, LIST_MAX) + (n > LIST_MAX ? 1 : 0);
  const placed = await $.ui.open({ id: PANE_ID, title: "Replay Theater", focus: true, closeOnEscape: true, rows, columns: 58 });
  // No room for a pane (a narrow terminal): draw the replay in the band.
  state.inBand = placed?.isPlaced === false;
  $.ui.invalidate("ui.render");
  return true;
}

function goTo($, to) {
  state.index = Math.max(0, Math.min(to, state.replay.length - 1));
  $.ui.invalidate("ui.render");
}

function closeReplay($) {
  state.isOpen = false;
  if (!state.inBand) $.ui.close({ id: PANE_ID });
  state.inBand = false;
  $.ui.invalidate("ui.render");
}

// The replay view: one step at a time. Drawn in the Pane, or in the band
// above the prompt when the surface can't place a pane.
function replayView($, e, inBand) {
    const ui = $.ui.resolve(e);
    const { Box, Text, Button } = ui;
    const go = (to) => goTo($, to);
    const close = () => closeReplay($);
    const buttons = (k) => Box({ key: "buttons", flexDirection: "row", flexWrap: "wrap", gap: 2, marginTop: 1, children: [
      Button({ key: "prev", label: "Previous edit", hotkey: "p", onPress: () => go(k - 1) }),
      Button({ key: "next", label: "Next edit", hotkey: "n", autoFocus: true, onPress: () => go(k + 1) }),
      Button({ key: "close", label: "Close", hotkey: "c", onPress: close }),
    ] });
    const focusHint = e.props.isFocused === false
      ? [Text({ key: "focus", dimColor: true, wrap: "truncate-end", children: "click to focus · /replay next, prev, close" })]
      : [];

    // Off the terminal the pane is one SVG card. The terminal's table carries an Svg that
    // draws nothing, so the surface is tested too.
    if (!inBand && state.replay.length && e.surface !== "terminal" && "Svg" in ui) {
      const k = Math.max(0, Math.min(state.index, state.replay.length - 1));
      const W = Math.max(240, Math.min(900, (e.props.bodyColumns || 40) * 8 - 8));
      const card = replaySvg(state.replay, k, W);
      return Box({ flexDirection: "column", children: [
        ui.Svg({ key: "card", source: card.source, alt: card.alt, width: W, height: card.height }),
        buttons(k),
        ...focusHint,
      ] });
    }

    const maxDiff = inBand ? Math.max(3, Math.min(MAX_DIFF_LINES, (e.props.maxRows || 20) - 7)) : MAX_DIFF_LINES;
    const total = state.replay.length;
    if (!total) return Text({ dimColor: true, children: "No edits to replay." });
    const k = Math.max(0, Math.min(state.index, total - 1));
    const step = state.replay[k];
    const width = Math.max(8, (e.props.bodyColumns || 100) - 4);
    const { add, del } = countChanges(step.diff);
    const shown = step.diff.slice(0, maxDiff);

    const diffRows = shown.map((l, n) => {
      const color = l.op === "+" ? "success" : l.op === "-" ? "error" : undefined;
      const line = `${l.op === "~" ? " " : l.op} ${l.t}`.slice(0, width);
      return Text({ key: `d${n}`, color, dimColor: l.op === " " || l.op === "~", wrap: "truncate-end", children: line });
    });
    if (step.diff.length > maxDiff) diffRows.push(Text({ key: "more", dimColor: true, children: `  … ${step.diff.length - maxDiff} more lines` }));
    if (!shown.length) diffRows.push(Text({ key: "empty", dimColor: true, children: "  (no line changes)" }));

    const t = totals(state.replay);
    let head;
    if (inBand) {
      // The band has few rows: a title line and one cell per edit, the current one highlighted.
      const strip = state.replay.map((s, n) =>
        Text({ key: `s${n}`, inverse: n === k, color: n === k ? "suggestion" : undefined, dimColor: n !== k, children: ` ${n + 1} ` }));
      head = [
        Box({ key: "title", flexDirection: "row", justifyContent: "space-between", gap: 1, children: [
          Text({ weight: "bold", color: "claude", wrap: "truncate-end", children: "▶ Replay Theater" }),
          Text({ weight: "bold", wrap: "truncate-end", children: `edit ${k + 1} of ${total}` }),
        ] }),
        Box({ key: "strip", flexDirection: "row", flexWrap: "wrap", children: strip }),
      ];
    } else {
      // The pane: the summary, then the edits in order with the viewed ones checked.
      const win = listWindow(total, k);
      const list = state.replay.slice(win.from, win.to).map((s, i) => {
        const n = win.from + i;
        const c = countChanges(s.diff);
        const marker = n < k
          ? Text({ color: "success", children: " ✓ " })
          : Text({ inverse: n === k, color: n === k ? "suggestion" : undefined, dimColor: n !== k, children: ` ${n + 1} ` });
        return Box({ key: `e${n}`, flexDirection: "row", gap: 1, children: [
          marker,
          Box({ flexShrink: 1, flexGrow: 1, children: Text({ weight: n === k ? "bold" : undefined, dimColor: n > k, wrap: "truncate-start", children: s.file }) }),
          Text({ dimColor: true, children: `+${c.add} -${c.del}` }),
        ] });
      });
      head = [
        Text({ key: "sum", weight: "bold", wrap: "truncate-end", children: `${plural(t.edits, "edit")} in ${plural(t.files, "file")}` }),
        Box({ key: "sumlines", flexDirection: "row", gap: 1, children: [
          Text({ color: "success", wrap: "truncate-end", children: `${plural(t.add, "line")} added,` }),
          Text({ color: "error", wrap: "truncate-end", children: `${t.del} removed` }),
        ] }),
        Text({ key: "listlabel", dimColor: true, wrap: "truncate-end", children: "THE EDITS, IN ORDER" }),
        ...list,
        ...(total > LIST_MAX ? [Text({ key: "listmore", dimColor: true, wrap: "truncate-end", children: `    ${win.from + 1} to ${win.to} of ${total}` })] : []),
        Text({ key: "editlabel", color: "suggestion", weight: "bold", wrap: "truncate-end", children: `EDIT ${k + 1} OF ${total}` }),
      ];
    }

    return Box({
      flexDirection: "column", borderStyle: "round", borderColor: "promptBorder", paddingX: 1,
      children: [
        ...head,
        Text({ weight: "bold", color: inBand ? "suggestion" : undefined, wrap: "truncate-start", children: step.file }),
        Box({ flexDirection: "row", gap: 2, children: [
          Box({ key: "meta", flexShrink: 1, children: Text({ dimColor: true, wrap: "truncate-end", children: `${step.tool}${step.note ? " · " + step.note : ""}` }) }),
          Text({ color: "success", children: `+${add}` }),
          Text({ color: "error", children: `-${del}` }),
        ] }),
        Box({ flexDirection: "column", marginTop: 1, children: diffRows }),
        buttons(k),
        ...focusHint,
      ],
    });
}

export function register(on, options) {
  // Slash command: /replay opens the pane.
  on("session.start", async ($, e, next) => {
    const r = await next(e);
    try {
      sw.sid = await $.session.id();
      await $.command.register({ name: "replay", description: "Replay Theater: step through the last turn's file edits. /replay next, prev or close drives the open view", argumentHint: "[next|prev|close]" });
      await poll($).catch(() => undefined);
      $.clock.every(POLL_MS, () => { void poll($).catch(() => undefined); });
    } catch { /* the mod still records */ }
    return r;
  });

  on("command.run", { command: "replay" }, async ($, e) => {
    if (sw.off) return { text: "Replay Theater is off. Turn it on with /mods." };
    const arg = String(e.args ?? "").trim().toLowerCase();
    if (state.isOpen && (arg === "next" || arg === "prev" || arg === "close")) {
      if (arg === "close") closeReplay($);
      else goTo($, state.index + (arg === "next" ? 1 : -1));
      return { text: arg === "close" ? "Replay Theater closed." : `Replay Theater: edit ${state.index + 1} of ${state.replay.length}` };
    }
    if (sw.hidden) await setHidden($, false);
    const opened = await openReplay($);
    return { text: opened ? `Replay Theater: ${state.replay.length} edits` : "Replay Theater: no edits in the last turn." };
  });

  // Record each edit, then let it run. Never blocks the call.
  on("tool.call", async ($, e, next) => {
    if (!sw.off && EDIT_TOOLS.has(e.tool)) {
      try {
        const steps = await stepsFor($, e);
        state.pending.push(...steps);
      } catch { /* recording must never stop the edit */ }
    }
    return next(e);
  });

  on("turn.start", ($, e, next) => {
    if (!e.agentId) state.pending = [];
    return next(e);
  });

  // At the end of a main-loop turn, the pending edits become the replay.
  on("turn.complete", async ($, e, next) => {
    const r = await next(e);
    if (sw.off || e.agentId || !state.pending.length) return r;
    state.replay = state.pending;
    state.pending = [];
    state.index = 0;
    state.turns++;
    $.ui.invalidate("ui.render");
    return r;
  });

  // The band above the prompt: the hint and a button that opens the pane.
  // Local change (Ben AI, 2026-10-16): draw the other mods' bands first, so
  // this band sits under them instead of replacing them.
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (sw.off || sw.hidden || e.props.hasSurvey) return next(e);
    if (state.isOpen && state.inBand) return replayView($, e, true);
    if (!state.replay.length || state.isOpen) return next(e);
    const rest = await next(e);
    const { Box, Text, Button } = $.ui.resolve(e);
    const band = Box({
      key: "replay-band", flexDirection: "row", gap: 2, paddingX: 1,
      children: [
        Box({ key: "hint", flexShrink: 1, children: Text({ color: "claude", weight: "bold", wrap: "truncate-end", children: hintText() }) }),
        Button({ key: "open-replay", label: "Replay", hotkey: "r", onPress: () => openReplay($) }),
      ],
    });
    return rest ? Box({ flexDirection: "column", children: [rest, band] }) : band;
  });

  // The pane.
  on("ui.render", { component: "Pane" }, ($, e, next) => {
    if (e.requestId !== PANE_ID || sw.off) return next(e);
    return replayView($, e, false);
  });

  // The person closed the pane (Escape): keep our flag in step.
  on("ui.close", ($, e, next) => {
    if (e.id === PANE_ID || e.requestId === PANE_ID) state.isOpen = false;
    $.ui.invalidate("ui.render");
    return next(e);
  });
}
