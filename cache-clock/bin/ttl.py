"""Prints "<ttl> <start>": the prompt-cache TTL this chat's main thread writes with (1h, 5m or
unknown) and, when the transcript shows it, when the last request started, in epoch milliseconds.

The cache lifetime counts from the start of the request that last wrote or read it, not from the
end of its reply (https://platform.claude.com/docs/en/build-with-claude/prompt-caching), so the
countdown has to start there. The start is the timestamp of the `api-request` row just before the
last reply's first block, or of the row before it when Claude Code logged no `api-request`.
"""
import glob, json, os, sys
from datetime import datetime

sid = sys.argv[1] if len(sys.argv) > 1 else ''
paths = glob.glob(os.path.expanduser(f'~/.claude/projects/*/{sid}.jsonl')) if sid else []
if not paths:
    print('unknown'); sys.exit(0)
with open(paths[0], 'rb') as f:
    f.seek(0, 2)
    f.seek(max(0, f.tell() - 3_000_000))
    tail = f.read().decode('utf-8', 'ignore').splitlines()[1:]

rows = []
for line in tail:
    try:
        rows.append(json.loads(line))
    except Exception:
        continue


def millis(row):
    try:
        return int(datetime.fromisoformat(row['timestamp'].replace('Z', '+00:00')).timestamp() * 1000)
    except Exception:
        return None


def is_reply(row):
    return row.get('type') == 'assistant' and not row.get('isSidechain')


answer = 'unknown'
for row in reversed(rows):
    if not is_reply(row):
        continue
    cc = ((row.get('message') or {}).get('usage') or {}).get('cache_creation') or {}
    if (cc.get('ephemeral_1h_input_tokens') or 0) > 0:
        answer = '1h'; break
    if (cc.get('ephemeral_5m_input_tokens') or 0) > 0:
        answer = '5m'; break

start = None
last = next((i for i in range(len(rows) - 1, -1, -1) if is_reply(rows[i])), None)
if last is not None:
    request_id = rows[last].get('requestId')
    # A reply is several rows (thinking, text, tool use) sharing one request id, and tool results
    # and attachments can sit between them. Walk back to its first row, stopping at the reply
    # before it; `boundary` is that earlier reply, so an api-request row found after it is ours.
    first, boundary = last, -1
    for i in range(last - 1, -1, -1):
        if not is_reply(rows[i]):
            continue
        if request_id and rows[i].get('requestId') == request_id:
            first = i
        else:
            boundary = i; break
    for i in range(first - 1, boundary, -1):
        if rows[i].get('type') == 'api-request':
            start = millis(rows[i]); break
    if start is None:
        for i in range(first - 1, -1, -1):
            if rows[i].get('type') in ('user', 'assistant') and not rows[i].get('isSidechain'):
                start = millis(rows[i]); break

print(answer if start is None else f'{answer} {start}')
