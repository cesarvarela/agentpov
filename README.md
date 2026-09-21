# agentview

A desktop app that shows **how a coding agent sees a folder**.

Point it at a project and select a file, and it answers: which `CLAUDE.md`
files and memory apply here, which settings are in effect, which permission
rules (allow / ask / deny) decide a tool call, which hooks fire for which
events, and which skills, subagents and MCP servers are available — with the
exact file and layer each one came from.

Claude Code first; the model is deliberately agent-agnostic so other agents can
follow.

Design mocks live in [`design/`](./design) (see `design/README.md`);
`agentview-mocks.html` is the full editable canvas bundle.

## Layout

```
agentview/
  apps/
    desktop/     @agentview/desktop  — Electron + Vite + React 19 + Tailwind v4
    landing/     @agentview/landing  — Next.js App Router marketing site
  packages/
    ui/          @agentview/ui       — shared shadcn components + design tokens
    core/        @agentview/core     — config resolution engine (stub today)
  design/        static hi-fi mockups
```

Tooling: pnpm workspaces + Turborepo, TypeScript everywhere, Tailwind v4 with a
single shared theme in `packages/ui/src/styles/globals.css`.

## Requirements

Node 24+, pnpm 10+.

## Getting started

```bash
pnpm install
```

### Run everything

```bash
pnpm dev          # turbo runs dev for both apps
pnpm build        # builds core, desktop and landing
pnpm typecheck
pnpm test
```

### Run one app

```bash
pnpm --filter @agentview/desktop dev     # Electron window + Vite HMR
pnpm --filter @agentview/landing dev     # http://localhost:3000
```

### Packages

```bash
pnpm --filter @agentview/core test       # vitest
pnpm --filter @agentview/ui typecheck
```

## Notes

- The desktop app uses [`electron-vite`](https://electron-vite.org) for the
  main / preload / renderer split. Packaging (electron-builder) is not wired up
  yet — `pnpm --filter @agentview/desktop build` produces `out/` only.
- `@agentview/ui` ships TypeScript source; consumers transpile it (Next.js via
  `transpilePackages`, the desktop renderer via Vite).
- Design tokens are defined once as `--om-*` custom properties and mapped onto
  shadcn's semantic tokens (`--background`, `--card`, `--primary` = amber,
  `--accent` = teal, …). The apps are dark by default.
