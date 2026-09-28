# ADR-001: Local-first, with no server in the capture path

- **Status:** Accepted
- **Date:** 2026-09-18
- **Supersedes:** —

## Context

JevTabs asks to observe how someone's attention moves through their browser. That is among the most revealing datasets a person can hand over: it contains what they are working on, what they are worried about, what they are job-hunting for, and what they looked up at 2am.

The default architecture for a product like this is a cloud service with a local agent. It makes sync, cross-device access, managed inference, and billing straightforward, and it is how most of the category is built.

It is also the reason most of the category is not installable by a thoughtful person.

## Decision

**The capture and knowledge layer is local-first, and the capture path makes no network request at all.**

Concretely:

- All data lives in the user's browser profile (IndexedDB now, SQLite in the companion later).
- There is no account, no server, no telemetry, and no crash reporter.
- Classification runs locally against a deterministic heuristic adapter.
- Agent hand-off is a local, deterministic assembly the person copies or downloads.
- Any future cloud capability is a separate, explicitly opted-into plane — never a dependency of the local one.

## Consequences

### What this buys

**The privacy claim becomes checkable rather than promised.** "We do not upload your browsing" is an assertion about a company's future behaviour. "There is no network call, and here is the permission list" is a property of an artefact you can inspect. The permission list in the manifest test is worth more than any privacy policy.

**Deletion is real.** Delete means the bytes are gone from the only place they existed. No backups to reason about, no "within 30 days", no subprocessor list.

**Adoption stops requiring trust.** Someone can install this without deciding whether to trust us, because nothing is being sent anywhere. That is the difference between a tool a careful person will try and one they will not.

**Payment failure cannot take away your data.** A commercial tier can add sync or hosted inference. It cannot disable local read, search, export, or the local MCP server, because those never depended on anything we operate.

### What this costs

**Sync is genuinely hard later.** Retrofitting multi-device sync onto a local-first store means conflict resolution, per-device cursors, and encrypted snapshots. We accept this cost; the alternative — build the server first and add privacy later — is not a thing that happens.

**No server-side intelligence by default.** Classification must be cheap and local. That is a real quality ceiling on the heuristic adapter, which is why `DecisionProvider` exists as a seam from day one.

**No usage analytics.** We cannot answer "how many people use Checkpoints?" from data. We answer it by asking dogfood users, which is slower and better.

**Storage is the user's problem.** Retention defaults and the storage inspector exist so it is a visible problem rather than a surprising one.

## Alternatives considered

**Cloud-first with local cache.** Rejected. It inverts the trust model: every byte transits a server we operate, and the privacy story becomes a policy document instead of an architecture. Also makes the extension useless offline.

**Local-first with opt-in telemetry.** Rejected for now. Even opt-in telemetry creates pressure to widen what is collected, and an events pipeline that exists is an events pipeline that grows. If it is ever added it will need its own ADR, and it could never include URLs, titles, queries, excerpts, or pack contents.

**Local storage, cloud classification.** Rejected as a default. Sending titles and hosts to a remote classifier is sending browsing history to a third party, whatever the payload minimization. It remains available as an explicit, clearly labelled mode behind `DecisionProvider` — the projection a provider sees is deliberately narrow so that mode stays honest.

## Enforcement

- No `fetch`, `XMLHttpRequest`, or `WebSocket` anywhere in the capture path.
- Domain packages have no network dependency; `pnpm test` runs with no browser, network, or model.
- The privacy suite asserts on the absence of canary bytes.
- The manifest test fails if install-time permissions widen.
