## Description

Summarize the change, **which issue it fixes** (if any), and why it is needed. Call out **dependencies** (new packages, Firebase / Electron version bumps, or local setup changes).

Fixes #(issue)

## Type of change

Remove lines that do not apply.

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] This change requires a documentation update

## Areas touched

Remove lines that do not apply.

- [ ] Main process (`src/main/**`)
- [ ] Preload / IPC bridge (`src/preload/**`, `src/shared/**`)
- [ ] Renderer / UI (`src/renderer/**`)
- [ ] Tests (`tests/**`)
- [ ] Tooling / config only (e.g. `electron.vite.config.ts`, CI, `package.json`)

## How has this been tested?

Describe what you ran so others can reproduce. Suggested commands for this repo:

- [ ] `pnpm typecheck`
- [ ] `pnpm test` (unit tests)
- [ ] `pnpm lint` (if applicable)
- [ ] `pnpm test:emulator` (only if you changed Firestore executor, sampler, or emulator-backed tests — needs Java + Firebase CLI)
- [ ] Manual smoke test: `pnpm dev` (describe the flow: which tab, profile kind, LLM provider, etc.)

**Notes (optional):** steps, edge cases, or “not tested because …”.

### Local environment

| | |
| --- | --- |
| **OS** (e.g. macOS 14, Ubuntu 22.04, Windows 11): | |
| **Node.js** (`node -v`; project expects **≥20**): | |
| **pnpm** (`pnpm -v`): | |
| **Profile / connection** (emulator vs live — if you exercised Firestore): | |

## UI changes (if any)

- [ ] N/A — no user-visible UI change
- [ ] Screenshots or screen recording attached (before / after helpful)

## Checklist

- [ ] My code follows the style guidelines of this project
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation (`README.md`, inline help, etc.)
- [ ] My changes generate no new warnings
- [ ] I have added or updated tests that cover the change (or explained why tests are not practical)
- [ ] `pnpm test` passes locally (and `pnpm test:emulator` if you touched Firestore integration paths)
- [ ] N/A — no downstream packages; this is a standalone desktop app (or describe any blocking upstream/downstream work)
