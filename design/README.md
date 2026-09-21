# agentview — UI mocks

Static hi-fi mockups for a desktop app (Electron + Vite) that shows how a coding
agent (Claude Code first) sees a folder: which CLAUDE.md files, memory, settings,
permission rules, hooks, skills, agents and MCP servers affect a given file.

Example project used in every screen: `~/projects/acme/shop-api`, selected file
`src/api/payments.ts`.

| Screen | Source | Render |
|---|---|---|
| File view (main screen) | `Main.dc.html` | `png/Main.png` |
| Hooks matrix (events × levels) | `Hooks.dc.html` | `png/Hooks.png` |
| Situation simulator (timeline of an Edit) | `Simulate.dc.html` | `png/Simulate.png` |
| Layers & precedence (Managed → User → Project → Local → Directory) | `Layers.dc.html` | `png/Layers.png` |
| Alt direction, low-fi: devtools-style inspector | `AltDense.dc.html` | `png/AltDense.png` |

## Workflows (low-fi storyboards, canvas page "Workflows")

| Story | Source | Render |
|---|---|---|
| Workflow map: personas, core loop, story index | `StoryOverview.dc.html` | `png/StoryOverview.png` |
| S1 Why did Claude ignore my instruction? | `S1IgnoredInstruction.dc.html` | `png/S1IgnoredInstruction.png` |
| S2 My hook didn't run | `S2HookDidntFire.dc.html` | `png/S2HookDidntFire.png` |
| S3 Is `.env` really unreadable? (team lead audit) | `S3SecretsAudit.dc.html` | `png/S3SecretsAudit.png` |
| S4 What is Claude working with here? (new repo) | `S4NewRepoOnboarding.dc.html` | `png/S4NewRepoOnboarding.png` |
| S5 Before I let it run: what will happen? | `S5WhatIfBeforeRun.dc.html` | `png/S5WhatIfBeforeRun.png` |
| S6 Same folder, different agent (future, Codex) | `S6CompareAgents.dc.html` | `png/S6CompareAgents.png` |

Story frames are 1600×620; screen frames are 1440×900.

- Each `*.dc.html` is a plain, self-contained 1440×900 HTML frame with inline
  styles; open it in any browser. The `./support.js` script tag is intentionally
  unresolved and harmless.
- `canvas.json` is the layout for the shared canvas: https://claude.ai/artifact/NU4Tk6ieNM8j5TNimcNtHF
- `../agentview-mocks.html` is the full editable canvas bundle (large; open in a browser).
- Design tokens: bg `#101216`, panel `#171a20`, raised `#1e222a`, border `#2a2f38`,
  text `#e6e8ec`, muted `#8b919c`, amber accent `#e8b04c` (applies/selected),
  teal `#4fc7c0` (hooks/links), allow `#5fbf7a`, ask `#e8b04c`, deny `#e5645f`.
  Fonts: IBM Plex Sans (UI), JetBrains Mono (paths/commands). Radius 6px.

Re-render PNGs:

    for f in Main Hooks Simulate Layers AltDense; do
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
        --window-size=1440,900 --hide-scrollbars --virtual-time-budget=4000 \
        --screenshot="png/$f.png" "file://$PWD/$f.dc.html"; done
