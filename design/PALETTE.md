# Color palette

One meaning per color. Before adding a color, check whether an existing one
already carries the meaning; before reusing one, check it does not already mean
something else. Tokens live in `packages/ui/src/styles/globals.css` as `--om-*`
and are exposed to Tailwind as `om-*` (`text-om-teal`, `bg-om-amber-bg`, ...).

## Surfaces and type

| token    | hex       | use                     |
| -------- | --------- | ----------------------- |
| `bg`     | `#101216` | window background       |
| `panel`  | `#171a20` | panels, cards           |
| `raised` | `#1e222a` | hover, active, popovers |
| `border` | `#2a2f38` | hairlines               |
| `muted`  | `#8b919c` | secondary text          |
| `text`   | `#e6e8ec` | primary text            |

## Semantic colors

| role               | token    | hex       | where it appears                                              |
| ------------------ | -------- | --------- | ------------------------------------------------------------- |
| App accent         | `amber`  | `#e8b04c` | logo, app name, selected row, focus ring. Nothing else.        |
| Agent identity     | `orange` | `#d97757` | Claude Code: active agent tab, instruction dots in the tree.   |
| Loaded always      | `teal`   | `#4fc7c0` | solid-disc loading glyph                                      |
| Loaded lazily      | `violet` | `#a78bfa` | half-disc (on read) and dashed-ring (on demand) glyphs        |
| Permission allow   | `allow`  | `#5fbf7a` | allow badges                                                  |
| Permission deny    | `deny`   | `#e5645f` | deny badges, denied files in the tree, disabled MCP servers    |

Things that deliberately have **no color**: `ask` decisions (muted), hooks,
links, MCP servers, layer badges (USER, PROJECT, ...). They are structure, not
state.

## Agents

Each supported agent gets exactly one identity color. Claude Code is orange.
A second agent adds one token; it must not reuse any semantic color above.

## Tints

Badge backgrounds and borders are derived, never hand-typed:

```
--om-<name>-bg:     color-mix(in srgb, var(--om-<name>) 12%, var(--om-bg))
--om-<name>-border: color-mix(in srgb, var(--om-<name>) 30%, var(--om-bg))
```

## Shape families

- Layer badges: square corners (`rounded-[4px]`), outlined, muted.
- Decision badges: pill (`rounded-full`), tinted with their color.
- Loading mode: 12px glyph, color says always vs lazy, fill says how.

## Budget

Six semantic colors plus one per agent is the ceiling on this background.
Merge meanings before adding a seventh.
