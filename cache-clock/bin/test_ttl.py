"""Fixture tests for ttl.py. Run: python cache-clock/bin/test_ttl.py"""
import json, os, subprocess, sys, tempfile
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
SID = '11111111-2222-3333-4444-555555555555'
BASE = 1_794_800_000


def ts(seconds):
    return datetime.fromtimestamp(BASE + seconds, timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'


def ms(seconds):
    return (BASE + seconds) * 1000


def api(t):
    return {'type': 'api-request', 'timestamp': ts(t)}


def reply(t, req, cc=None, side=False):
    usage = {'cache_creation': cc} if cc else {}
    return {'type': 'assistant', 'timestamp': ts(t), 'requestId': req, 'isSidechain': side, 'message': {'usage': usage}}


def user(t):
    return {'type': 'user', 'timestamp': ts(t)}


def attach(t):
    return {'type': 'attachment', 'timestamp': ts(t)}


HOUR = {'ephemeral_1h_input_tokens': 10, 'ephemeral_5m_input_tokens': 0}
FIVE = {'ephemeral_1h_input_tokens': 0, 'ephemeral_5m_input_tokens': 10}


def run(rows):
    with tempfile.TemporaryDirectory() as home:
        folder = os.path.join(home, '.claude', 'projects', 'p')
        os.makedirs(folder)
        with open(os.path.join(folder, f'{SID}.jsonl'), 'w', encoding='utf-8') as f:
            # ttl.py drops the first line of its tail read, which may be cut off mid-line.
            f.write('\n'.join(json.dumps(r) for r in [attach(0), *rows]) + '\n')
        env = {**os.environ, 'HOME': home, 'USERPROFILE': home}
        out = subprocess.run([sys.executable, '-I', os.path.join(HERE, 'ttl.py'), SID], env=env,
                             capture_output=True, text=True, check=True)
        return out.stdout.strip()


CASES = [
    ('plain reply: starts at its api-request',
     [user(9), api(10), reply(15, 'a', HOUR)], f'1h {ms(10)}'),
    ('reply interleaved with a tool result and attachments',
     [user(9), api(10), reply(15, 'a', FIVE), user(15.2), *[attach(15.3)] * 6, reply(16, 'a')],
     f'5m {ms(10)}'),
    ('seven rows between the api-request and the reply',
     [user(9), api(10), *[attach(11)] * 7, reply(15, 'a', HOUR)], f'1h {ms(10)}'),
    ('no api-request row: starts at the row before the reply',
     [user(9), reply(15, 'a', HOUR)], f'1h {ms(9)}'),
    ('the previous reply api-request is not borrowed',
     [api(1), reply(5, 'a', HOUR), user(20), reply(30, 'b', HOUR)], f'1h {ms(20)}'),
    ('a sidechain reply after the main one is ignored',
     [api(10), reply(15, 'a', HOUR), reply(40, 'x', HOUR, side=True)], f'1h {ms(10)}'),
    ('no cache write anywhere: unknown length, start still known',
     [api(10), reply(15, 'a')], f'unknown {ms(10)}'),
]

failed = 0
for name, rows, expected in CASES:
    got = run(rows)
    ok = got == expected
    failed += not ok
    print(('pass' if ok else 'FAIL'), name, '' if ok else f'(expected {expected!r}, got {got!r})')
sys.exit(1 if failed else 0)
