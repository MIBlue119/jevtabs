# Roadmap

Each phase has a gate. **A gate is a decision point, not a milestone to celebrate past** — if Phase 1 shows people do not revisit Threads, the right move is to fix the core loop, not to start Phase 2.

---

## Phase 0 — Contracts and repository ✅

Monorepo, domain packages, Zod contracts, versioned event envelopes, synthetic fixtures, CI, ADRs.

**Gate — met.** A clean checkout passes every command; schema fixtures round-trip; no vendor type leaks into a domain package; privacy-sensitive fields are documented in the capture contract.

## Phase 1 — Extension-only alpha ◐

Capture and policy, Visit construction, heuristic classification, the side panel, the workspace, review, Checkpoints, Markdown and JSON export, and local Context Pack assembly.

**Built.** All of the above, plus the first vertical slice's acceptance criteria:

- install the unpacked extension;
- see tracking state and inspect exactly what is stored;
- foreground and navigate to produce a valid Visit timeline;
- leave background and stale tabs untouched, with no false Visits;
- pause tracking and exclude a domain (which also erases what that domain already produced);
- kill the service worker or restart the browser with neither loss nor duplication;
- verify that forbidden fields never enter storage.

**Gate — not yet met.** Needs real usage:

- [ ] five dogfood users run it for one work week;
- [ ] ≥70% of high-confidence assignments need no correction;
- [ ] median inbox correction under 10 seconds;
- [ ] ≥3/5 users resume or export prior work twice;
- [ ] privacy canaries find no prohibited data in real profiles.

**Stop here and improve the core loop if users do not revisit Threads or reuse exported context.** That finding would be worth more than any amount of Phase 2.

## Phase 2 — Local companion and durable search

Tauri 2 with Rust, SQLite in WAL mode with FTS5, Native Messaging with versioned envelopes and idempotent acknowledgements, migration from IndexedDB, OS keychain integration, backup and restore, and optional local embeddings.

**Gate.** Crash-safe idempotent sync; migrations preserve export equivalence; search p95 under 300 ms at 100k Visits and 10k sources; the extension remains fully useful when the companion is not running.

## Phase 3 — Agent product

The Context Broker already exists (see [ADR-004](adr/ADR-004-context-pack-before-mcp.md)). This phase adds the transport around it: a local stdio MCP server, per-client scopes, audit records, prompt-injection isolation, the agent-activity UI, and review-only writeback.

Planned tools: `search_threads`, `get_thread`, `get_source`, `build_context`, `propose_finding`, `attach_artifact`. Default scopes: `threads.search`, `threads.read.summary`, `sources.read.excerpt`, `findings.propose`, `artifacts.attach`. Raw source reads, mutation, confirmation, and deletion each need separate explicit consent.

Local stdio only. No unauthenticated localhost port, ever.

**Gate.** A documented coding workflow succeeds end to end through the public MCP surface; every fact resolves to a source or an inference label; out-of-scope access fails closed; instructions embedded in a page cannot trigger a tool.

## Phase 4 — Optional paid cloud

**Starts only after repeated, unprompted demand for cross-device or remote-agent access.** Cloudflare Workers, D1, R2, hosted merchant-of-record checkout, entitlements, export and deletion, and explicit privacy modes.

**Gate.** A cloud outage never blocks local use; billing and webhook replay are idempotent; ten design partners explicitly trial a paid capability.

---

## Open-source and commercial boundary

The privacy-sensitive local trust boundary stays open under Apache-2.0, permanently: the extension, the local companion, the database and migrations, the domain schemas and import/export format, the local classifier and provider SDK, the local MCP server, and the security and privacy tests.

Managed operations may be commercial: hosted sync, managed inference, a remote MCP gateway, team collaboration, billing, and abuse protection.

Two commitments that constrain every future decision:

- **The community edition stays useful forever without payment** — local capture, organization, search, export, and local MCP.
- **Payment failure may disable managed services. It may never disable local read, search, export, or local MCP.** Those depend on nothing anyone operates, and that is deliberate.

## Explicitly not planned

Building a browser or an autonomous browsing operator. Automatically closing, moving, or rearranging tabs. Importing entire browser history on install. Capturing keystrokes, form values, cookies, auth headers, or screenshots. Letting agents overwrite human-confirmed knowledge. Requiring an account, Docker, or a self-hosted server. Multi-user collaboration, enterprise administration, mobile, Firefox, or Safari.
