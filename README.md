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
pnpm --filter @agentview/landing dev     # http://localhost:4000
```

### Packages

```bash
pnpm --filter @agentview/core test       # vitest
pnpm --filter @agentview/ui typecheck
```

## Packaging the desktop app

```bash
pnpm --filter @agentview/core build             # desktop bundles core from dist/
pnpm --filter @agentview/desktop dist:unsigned  # no signing, no notarization
open apps/desktop/release/agentview-mac.dmg
```

This produces a universal (Apple Silicon + Intel) `agentview-mac.dmg` in
`apps/desktop/release/`. Unsigned builds run on the machine that built them;
anywhere else Gatekeeper blocks them. `dist` is the signed variant and is
what CI runs.

The app icon (`apps/desktop/build/icon.icns`) is a placeholder rendered from
`build/icon.svg`; regenerate it with `pnpm --filter @agentview/desktop make-icon`.

## Releasing

Push a version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

`.github/workflows/release.yml` builds the DMG on `macos-latest`, signs it with
the Developer ID certificate, notarizes and staples it, and uploads
`agentview-mac.dmg` to the GitHub Release for that tag. The app version is
taken from the tag (`v0.1.0` → `0.1.0`; a tag with a `-` is published as a
prerelease). The landing page links to
`https://github.com/cesarvarela/agentview/releases/latest/download/agentview-mac.dmg`,
so the asset name must stay version-less. Running the workflow manually on a
branch builds and signs the same DMG and attaches it to the run instead.

Required repository secrets:

| secret             | value                                                          |
| ------------------ | -------------------------------------------------------------- |
| `CSC_LINK`         | Developer ID Application certificate + key, `.p12`, base64     |
| `CSC_KEY_PASSWORD` | password of that `.p12`                                        |
| `APPLE_API_KEY`    | contents of the App Store Connect API key (`AuthKey_XXXX.p8`)  |
| `APPLE_API_KEY_ID` | that key's ID                                                  |
| `APPLE_API_ISSUER` | the App Store Connect issuer ID                                |

The workflow fails early if any of them is missing, and checks the result with
`codesign`, `stapler validate` and `spctl` before publishing.

`.github/workflows/ci.yml` runs `pnpm typecheck` and the core tests on every
push and pull request to `main`.

## Notes

- The desktop app uses [`electron-vite`](https://electron-vite.org) for the
  main / preload / renderer split and
  [`electron-builder`](https://www.electron.build) for packaging
  (`apps/desktop/electron-builder.yml`). Every library is bundled into `out/`,
  so the desktop package keeps them all in `devDependencies` and the packaged
  app ships no `node_modules`.
- `@agentview/ui` ships TypeScript source; consumers transpile it (Next.js via
  `transpilePackages`, the desktop renderer via Vite).
- Design tokens are defined once as `--om-*` custom properties and mapped onto
  shadcn's semantic tokens (`--background`, `--card`, `--primary` = amber,
  `--accent` = teal, …). The apps are dark by default.

## License

[MIT](./LICENSE)
