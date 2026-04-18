# Firestore Query Studio (natural language)

**Inspiration:** [iamEtornam/db-lang](https://github.com/iamEtornam/db-lang) (“Query Studio”) — local-first desktop shell, natural language → executable data access, step-by-step explanations, sortable results, credentials kept on device. This plan is the same product shape aimed at **Firebase** (Firestore first, Storage later) instead of SQL engines.

**Category:** Developer tools / Firebase  
**Status:** Not started (spec only)

## Problem statement

Working in the **Firebase console**, finding a specific document is often slower than the data deserves. You pick a project, drill through **collections and subcollections**, paginate or scroll long lists, and fight **dropdowns and navigation** just to answer a simple question — for example, “which document in this `users` collection has **this email**?” The console is fine for browsing structure; it is not optimized for **intent-driven lookup** (type what you know → see the row).

This app would flip that: after a **one-time connection** to a project, you type a **plain request** (email, ID fragment, phone, order code, or a short sentence). The tool turns that into a **Firestore query** (or a bounded, explained scan when a query is not enough), runs it, and returns **matching documents** in a table you can sort and copy from — without menu archaeology.

A second pain is **local development**: you already have **real-shaped rows** in a collection and a **mental model** (or a schema/type snippet) of what “good” data looks like. Hand-authoring dozens of dummy documents in the console is tedious. You want to **paste or describe the model in a text field** (and optionally point at existing docs as a template) and have the app **write** realistic seed data into a chosen collection — with preview and guardrails.

**Later (out of initial scope):** the same interaction pattern for **Cloud Storage** — locate files, read metadata or contents where safe, and **upload** assets (e.g. images) without living only inside the Storage tree UI.

## Product phases

| Phase | Focus | Summary |
|-------|--------|--------|
| **1** | **Read — find data** | Connect project → natural language or structured hints (e.g. paste email) → AI proposes Firestore query → run → results table, explanations, index links when queries fail. **No writes.** |
| **2** | **Write — dummy / seed data** | User supplies **NL + optional inline model** (JSON schema, TypeScript-ish shape, or field list) and/or **samples from existing collection** → preview generated documents → confirm → batched writes to a **named target collection** with caps, allowlists, and clear “WRITE MODE” labeling. |
| **3** | **Storage** | Extend connection to **Firebase Storage**: search/list by path or NL, read or preview files where appropriate, **save / upload** images (and other blobs) with the same “preview then commit” habit as Phase 2. |

Phases are sequential: ship Phase 1 before enabling Phase 2 writes; Phase 3 assumes Firestore patterns (auth, project profile, safety UX) are already proven.

## Concept (core loop)

- **Connection:** Firebase project + auth path the operator controls (e.g. service account JSON for Admin SDK, or web config + signed-in user for client SDK). Store profiles locally; never send secrets to a third party except the chosen LLM provider if cloud models are used.
- **Input:** Plain-language question scoped to one or more collections (and optional subcollections / collection groups). Phase 2 adds **inline model text** and optional attachment of sample JSON from the current result set.
- **Output:** A **Firestore-shaped plan** the app can run: collection path, filters, `orderBy`, `limit`, cursor/pagination — not SQL. Optional: show the equivalent REST/SDK pseudo-code.
- **Explanation:** Short breakdown of what the query does and which fields or indexes it depends on (mirrors db-lang’s “logic breakdown”).
- **Results:** Table view with sorting on the **current page** of results, export JSON/CSV, copy document IDs.

## Phase 2 — Dummy data generation (detail)

- **Goal:** From NL plus **model-in-the-text-field** (and optionally “make it like these rows”), produce **new documents** whose **field layout, types, and optional enums** match inferred or stated structure — not random unrelated fields.
- **Flow:** (1) User picks source collection(s) or pastes a schema / model in the prompt. (2) App samples N existing documents when requested (with caps and PII warnings). (3) NL describes volume, variance rules, and **target collection** (e.g. `dev_orders`, `users_seed`). (4) Preview: field list, estimated doc count, batch count. (5) Explicit confirm + optional **dry-run** (generate JSON locally, no write). (6) Execute batched writes (`set`/`create` with new auto IDs or deterministic test IDs under a prefix).
- **Constraints:** Respect Firestore **batch limits** (500 ops per batch); chunk automatically. Prefer **new IDs** or a clear naming convention (`seed_{timestamp}_…`) so deletes are easy. Optional: write only if **target collection name** matches an allowlist regex (e.g. must contain `test` or `dev`) to reduce fat-finger prod damage.

## Differentiators vs cloning db-lang

- Teach the model **Firestore rules**: inequality on one field, range + equality constraints, mandatory composite indexes, when to use `collectionGroup` vs root collection.
- **Safety modes:** Phase 1 is **read-only**. Phase 2 adds an **armed** write mode: confirm dialog, optional collection allowlist, optional max docs per run, and obvious UI labeling (“WRITE MODE”).
- **Admin vs client:** If using Admin SDK, call out that **security rules are bypassed** — same honesty as any admin tool. If using client SDK, behavior follows deployed rules.

## MVP (Phase 1 only)

1. Single project profile, NL or pasted identifier → query → run → table.  
2. Handle “not expressible as a single query” by suggesting two-step flows or a bounded scan with warnings.  
3. Surface **index build links** from Firebase error messages when a composite index is missing.

## Stack (suggestion only)

Tauri or Electron + web UI (matches db-lang’s native feel), Firebase Admin Node in a small local sidecar, or pure web if everything stays in-browser with Rex-owned keys — pick based on whether you want offline profiles and filesystem access to service account files. Phase 3 adds Storage SDK usage alongside Firestore.

## Optional: Paperclip + Cursor for agent runtime (orchestration)

If this app should participate in **Paperclip**-managed agents (tasks, heartbeats, budgets, audit trail) and use **Cursor’s models** through the same path Paperclip uses, the integration is **not** a special Cursor IDE plugin. [Paperclip](https://github.com/paperclipai/paperclip) runs the **Cursor Agent CLI on the same machine as the Paperclip server**, pipes the run prompt on **stdin**, and parses **stream-json** output. Official adapter list: [Adapters overview](https://docs.paperclip.ing/adapters/overview).

### How it works (mechanically)

1. **Paperclip control plane** — You run Paperclip locally (e.g. `npx paperclipai onboard --yes` or clone + `pnpm dev`); API defaults to `http://localhost:3100`. See the repo [README](https://github.com/paperclipai/paperclip/blob/master/README.md).
2. **Adapter type** — Hire or configure an agent with adapter **`cursor`** (“Cursor CLI (local)” in the [adapters table](https://docs.paperclip.ing/adapters/overview)). That selects the `cursor-local` package in Paperclip, which implements execution.
3. **Child process** — On each heartbeat/run, Paperclip spawns the configured command (default **`agent`**, i.e. Cursor Agent CLI), with arguments including:
   - `-p` (print/non-interactive style),
   - `--output-format stream-json` (structured logs for the Paperclip run viewer),
   - `--workspace <cwd>` (working copy, usually the linked project workspace),
   - optional `--resume <sessionId>` when the previous session’s cwd matches (session continuity across heartbeats),
   - optional `--model <id>` (e.g. `auto` or a specific Cursor model id),
   - optional `--mode plan` or `--mode ask` for constrained modes,
   - unless you already pass trust flags, Paperclip adds **`--yolo`** so the CLI does not block on interactive prompts.
4. **Prompt delivery** — The full run prompt (instructions file + wake payload + template) is **piped to the CLI via stdin** (see `packages/adapters/cursor-local/src/server/execute.ts` in the Paperclip repo).
5. **Environment** — Paperclip injects **`PAPERCLIP_*` variables** (agent id, company id, run id, API URL, short-lived **`PAPERCLIP_API_KEY`**, task/comment wake fields when relevant). Agents are expected to call the Paperclip API with `Authorization: Bearer` and `X-Paperclip-Run-Id` on mutating requests; see [How agents work](https://docs.paperclip.ing/guides/agent-developer/how-agents-work.md) and [Heartbeat protocol](https://docs.paperclip.ing/guides/agent-developer/heartbeat-protocol.md).
6. **Skills** — Paperclip can **symlink** bundled skills into `~/.cursor/skills` so the Cursor agent discovers them on local runs (same adapter code path).
7. **Billing metadata** — The adapter classifies billing as **subscription** vs **api** based on whether **`CURSOR_API_KEY`** or **`OPENAI_API_KEY`** is set in the effective environment; cost attribution flows back into Paperclip’s usage parsing like other local CLI adapters.

### Operator checklist (to replicate for this Firestore app later)

1. Install and run **Paperclip** on a host you control; complete **onboard** / company + agent setup.
2. On that **same host**, install **Cursor Agent CLI** so the `agent` command resolves on `PATH` (Paperclip verifies the command before spawn).
3. Create a **project workspace** in Paperclip pointing at the git repo (or folder) where this Firestore tool will live (`cwd` / workspace link).
4. **Hire** an agent with **`adapterType: "cursor"`** and `adapterConfig` aligned with Paperclip’s cursor adapter (e.g. `cwd`, `model`, optional `instructionsFilePath`, `promptTemplate`, `heartbeatSchedule`, `timeoutSec`, `extraArgs` if you need non-default CLI flags).
5. Store any secrets (API keys) via Paperclip **company secrets** and reference them in `adapterConfig.env` with `{{SECRET_NAME}}` per [Paperclip secrets docs](https://docs.paperclip.ing/api/secrets) / adapter guides.
6. Test with **`paperclipai heartbeat run --agent-id <id>`** (or equivalent) and confirm stdout shows Cursor stream-json and session id persistence when resuming.

### Caveats for product planning

- **Same machine:** The Cursor adapter is **local process** execution; Paperclip must reach the workspace on disk. Remote-only Sandboxed Cursor is listed as roadmap territory on Paperclip’s README, not the default path.
- **Not the IDE:** This path is **Cursor Agent CLI + Paperclip**, not “Cursor the editor opens automatically.” Day-to-day IDE use stays separate unless you also work in Cursor manually.
- **For Phase 1–3 of this app:** You can still ship with **direct** Gemini/OpenAI/etc. in-app; Paperclip + Cursor is an **optional** ops layer for teams that already run Paperclip.

### References

- Repo: [github.com/paperclipai/paperclip](https://github.com/paperclipai/paperclip)  
- Adapters overview (includes **Cursor Local** / type key `cursor`): [docs.paperclip.ing/adapters/overview](https://docs.paperclip.ing/adapters/overview)  
- Implementation detail: `packages/adapters/cursor-local/` in the Paperclip tree (e.g. `src/server/execute.ts`, `src/index.ts` for model list and config doc string).

## Risks / open questions

- Cost and latency for large collections without good filters.  
- Hallucinated field names — mitigate with optional **schema snapshot** (sample docs or exported typings).  
- Multi-tenant data: scope connections per environment (dev/staging/prod) and label results clearly.  
- **Writes (Phase 2):** accidental seeds into production; mitigate with allowlists, env-colored profiles, and undo story (Firestore has no bulk undo — document a **delete-by-query** or “delete all with prefix” helper for seed IDs only).  
- **PII:** sampling real docs for shape may still pull sensitive values into logs or LLM context — redact or hash fields by name pattern before sending to a cloud model; prefer local model for paranoid teams.  
- **Rules:** client-SDK seeding may fail on rules; surface errors clearly and suggest Admin SDK for dev projects only.  
- **Storage (Phase 3):** MIME/size limits, download costs, and never piping unexpected binaries into an LLM without explicit user action and size caps.
