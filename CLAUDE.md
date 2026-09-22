# agentview

Desktop app that shows what an AI coding agent sees for a file or folder:
instructions, memory, permission rules, hooks, skills, subagents, MCP servers.

## Layout

- `packages/core` — config resolver (`resolveContext`). Pure, injectable fs, tested with vitest. Desktop bundles it from `dist`, so run `pnpm -F @agentview/core build` after changing it.
- `packages/ui` — shadcn-style components and the design tokens (`src/styles/globals.css`). Exports `src/` directly, no build.
- `apps/desktop` — Electron renderer (`src/renderer/src`), main and preload. Changing main or preload needs an Electron restart; the renderer hot-reloads.
- `apps/landing` — Next site on port 4000.

## Design

- Colors: follow [design/PALETTE.md](design/PALETTE.md). One meaning per color, use `om-*` tokens, never hand-typed hex in components.
- Mocks and tokens history: [design/README.md](design/README.md).

## Commands

```bash
pnpm typecheck
pnpm -F @agentview/core test
```
