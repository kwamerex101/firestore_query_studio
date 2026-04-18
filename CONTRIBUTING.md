# Contributing to Firestore Query Studio

Thanks for taking the time to contribute. This is a small open-source project; issues, docs, tests, and focused PRs are all welcome.

## Code of conduct

Be kind, be precise, assume good intent. Treat the issue tracker, PR reviews, and commits as professional correspondence.

## Prerequisites

- **Node.js ≥ 20**
- **pnpm** (`corepack enable && corepack prepare pnpm@latest --activate` or `npm i -g pnpm`)
- **Java 11+** (only for `pnpm test:emulator`)
- **Firebase CLI** (only for `pnpm test:emulator`): `npm i -g firebase-tools`

## Getting started

```bash
git clone https://github.com/kwamerex101/firestore_query_studio.git
cd firestore_query_studio
pnpm install
pnpm dev
```

See [`README.md`](./README.md) for the full tour (profiles, LLM providers, architecture).

## Branching & commits

- Fork the repository and create a branch from `main` (e.g. `feat/schema-cache-ttl`, `fix/results-export-csv`).
- Keep commits **small and descriptive**. Imperative subjects: *“Add schema cache TTL”*, not *“added schema cache TTL”*.
- Use **Conventional-style** prefixes where they help — `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`. They are not enforced by CI but make the history easier to scan.

## What good PRs look like

- Target **one concern** per PR. Split unrelated changes.
- Update docs (`README.md`, inline help, JSDoc) when behaviour changes.
- Change IPC or shared **Zod** schemas in both main and preload/renderer clients in the same PR. Add or update the relevant tests.
- Attach a **screenshot or short screen recording** when you change the UI.
- Fill in the default [pull request template](./.github/pull_request_template.md); uncheck rows that do not apply.

## Local checks (run these before opening a PR)

```bash
pnpm typecheck
pnpm test
pnpm lint          # optional; project still stabilizing
pnpm format        # optional; run if you changed many files
```

If you changed anything under `src/main/firestore/**` (executor, sampler, schema cache) or the emulator test setup, also run:

```bash
pnpm test:emulator   # needs Java + Firebase CLI
```

## CI

Pushes and PRs run the workflow at [`.github/workflows/ci.yml`](./.github/workflows/ci.yml):

- `pnpm install --frozen-lockfile`
- `pnpm typecheck`
- `pnpm test`

The emulator-backed tests are **not** part of CI yet (they need Java and the Firebase CLI). Run them locally when relevant.

## Reporting bugs & asking for features

- **Bug reports** — use a clear title; include repro steps, expected vs actual, OS, Node version, whether the issue reproduces against the emulator.
- **Feature requests** — describe the user story, not just the implementation; include the problem you are trying to solve.
- **Security issues** — see [`SECURITY.md`](./SECURITY.md). Do not file them in public issues.

## Reviewing & merging

- `main` is protected and requires at least one approval.
- **Code owners** are listed in [`.github/CODEOWNERS`](./.github/CODEOWNERS).
- Once a PR is approved and checks pass, the maintainer will merge. Prefer **squash merge** for small PRs; rebase for stacked work.

## Releases

Pre-1.0: there is no strict cadence. A release will be cut when a meaningful batch of changes lands on `main` and the app is smoke-tested locally. Keep entries that are worth mentioning in the PR description so they can be pulled into release notes.

## Project scope reminder

Phase 1 is **read-only**. Proposals that add mutation paths (writes, deletes, seeding) will usually be deferred to Phase 2 — that is intentional. See [`firestore-nl-query.md`](./firestore-nl-query.md) for the phased vision.

Thanks again — see you in the issue tracker.
