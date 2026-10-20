# filetree

Fork of [data-goblin/claude-code-filetree](https://github.com/data-goblin/claude-code-filetree) 0.2.26 (commit `4f04e60`), MIT. Everything upstream does is unchanged; see its README for the full feature list.

What the fork adds: the tree shows only the files Claude touched this session (read, written, or returned by a Grep or Glob search) and the folders above them. Files Claude has not touched stay hidden.

- The header's `◆` button toggles to the whole tree and back (`◇` while the whole tree shows).
- A search still looks through every file.
- The `Show` option (`touched` or `all`, default `touched`) sets which view a session starts in.
- What counts as touched follows the `Claude activity` option: with `none`, only Edit and Write calls are recorded.
