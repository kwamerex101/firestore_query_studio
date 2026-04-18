# Security Policy

Thanks for helping keep **Firestore Query Studio** and its users safe.

## Supported versions

This project is pre-1.0 and iterates quickly; security fixes are made against the latest `main` only.

| Version | Supported          |
| ------- | ------------------ |
| `main`  | ✅ security fixes   |
| tagged pre-1.0 releases | ⚠️ best-effort |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Prefer one of:

1. **GitHub private advisory** — go to the repository’s [Security tab → Report a vulnerability](https://github.com/kwamerex101/firestore_query_studio/security/advisories/new). This is the recommended channel.
2. **Direct contact** — open a minimal **private** GitHub issue by emailing the maintainer via the email on the GitHub profile [@kwamerex101](https://github.com/kwamerex101), clearly marking the message as a security report.

When reporting, include:

- A clear description of the issue and the impact.
- Steps to reproduce (minimal repro, commands, screenshots).
- Affected component: **main** (Electron), **preload / IPC**, **renderer**, **LLM path**, **secrets storage**, or **Firestore executor**.
- Environment: OS, Node.js version, pnpm version, whether the issue is exploitable against a **live** Firebase project or only the emulator.
- Any suggested mitigation, if you have one.

## Our commitment

- Acknowledge the report within a few business days.
- Keep the reporter updated while a fix is scoped.
- Credit reporters in the release notes unless you ask to stay anonymous.
- Coordinate public disclosure after a fix is available.

## Threat model (non-goals you should know)

Some design decisions intentionally limit what this project tries to defend against:

- **Admin SDK profiles bypass Firestore security rules** by design. Use dev / emulator profiles while exploring. This is a property of Firebase Admin SDK, not a vulnerability.
- **Prompts and schema snapshots are sent to whatever LLM endpoint you configure.** The project cannot know if that endpoint is safe; avoid pasting real secrets into the natural language question box.
- **Local secrets** use Electron `safeStorage` when available. On OSes where that is unavailable (some Linux setups), the app falls back to a `chmod 0600` file and logs a warning — this is a documented trade-off.

Reports about documented trade-offs are welcome but may be resolved as **won’t fix** with an explanation, rather than as a CVE.

## Scope

In scope:

- Main / preload / renderer code in `src/**`
- IPC validators and Zod schemas in `src/shared/**`
- Secrets storage (`src/main/profiles/secrets.ts`)
- Firestore executor & index hint parsing (`src/main/firestore/**`)
- LLM clients and prompts (`src/main/llm/**`)

Out of scope:

- Vulnerabilities in upstream dependencies (report them upstream; we will track updates).
- Issues that require physical access to an already-unlocked developer machine.
- Social engineering of maintainers or contributors.

Thanks again for practicing responsible disclosure.
