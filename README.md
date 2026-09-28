# JevTabs

**A local-first browser context workspace.** JevTabs watches how your attention actually moves through the browser, reconstructs the work you were doing, and keeps it as durable, source-backed Threads you — or an agent you explicitly authorize — can pick up days later.

> A tab is an ephemeral container. A meaningful foreground Visit is the unit of attention; a Thread is the durable unit of intent.

It is not a tab manager. It never closes, moves, or rearranges your tabs.

## Why

By Friday afternoon the browser has stopped being a workspace and started being a landfill. Forty tabs, four unrelated projects, three of them from last week. The context that made those tabs make sense lived in your head, and it is gone.

JevTabs reconstructs that context from the one signal that actually correlates with intent — where your attention went, for how long, arriving from where — and keeps the result somewhere durable.

## What it does

- **Notices meaningful Visits.** Foreground attention only. A tab that has been open for sixteen days without being looked at produces nothing.
- **Proposes Threads, and explains why.** Every assignment records which classifier decided it, how confident it was, and the signals behind it.
- **Asks only when genuinely unsure.** High-confidence work is filed quietly. Ambiguity becomes a one-click Activity Inbox item rather than a silent wrong guess.
- **Learns from corrections.** Your correction is appended as a new revision; the original decision is kept so accuracy stays measurable.
- **Saves Checkpoints.** Intent, sources, findings, open questions, next action — so a paused Thread can be resumed in a week without rebuilding it from memory.
- **Builds Context Packs.** A cited, token-bounded handoff for an agent, with an explicit list of what was left out and why.

## Privacy

This is the part of the product that is not negotiable, so it is stated as a contract and enforced by tests.

JevTabs **never** collects:

- keystrokes, input values, textarea or contenteditable content, passwords, or payment details;
- cookies, authorization headers, session tokens, or clipboard contents;
- **any** incognito activity;
- screenshots or hidden DOM;
- URL fragments, or query values unless you explicitly opt a parameter in.

Authentication, banking, health, identity, password-manager, and payment surfaces are denied by default. You can exclude any domain, pause tracking, and delete anything — deletion removes searchable content immediately and leaves only a tombstone recording that a deletion happened, never what it said.

Everything stays on your machine. There is no account, no server, and no network call in the capture path. The privacy suite ([`test/privacy`](test/privacy)) asserts on the *absence* of specific canary bytes rather than on the presence of a policy, because a policy that is right in prose and wrong in one field is, from your point of view, no policy at all.

Page text is always tagged `untrusted_source_content`. It reaches a model or agent as quoted evidence; text inside a page can never authorize a tool, widen a scope, or change a rule.

See [`docs/privacy/CAPTURE_CONTRACT.md`](docs/privacy/CAPTURE_CONTRACT.md) for the full contract.

## Status

**Phase 1, alpha.** The capture loop, sessionization, classification, review, Checkpoints, and the workspace UI work end to end, locally, with no network. The local companion (SQLite + FTS5), the MCP server, and any cloud capability are later phases — deliberately not started until the core loop has been shown to be useful. See [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Install from source

```bash
corepack enable
pnpm install
pnpm build
```

Then load the unpacked extension:

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. **Load unpacked** → select `apps/extension/.output/chrome-mv3`.

Chrome 116+ or the equivalent Edge. Firefox and Safari are not supported.

For live development:

```bash
pnpm dev
```

## Using it

| Surface | What it is for |
|---|---|
| **Popup** (toolbar icon) | Tracking state, pause, exclude this domain, open the workspace |
| **Side panel** | Stay oriented while browsing: current Thread, confidence, why, checkpoint |
| **Workspace** (full tab) | Today, Activity Inbox, Threads, Thread detail, Agent Context, Settings |

Browse normally for a while. Visits accumulate, Threads get proposed, and anything genuinely ambiguous lands in the Activity Inbox for a one-second decision.

## Development

```bash
pnpm typecheck        # TypeScript across every package
pnpm lint             # ESLint
pnpm format:check     # Prettier
pnpm test             # every suite
pnpm test:contracts   # wire-shape round trips
pnpm test:privacy     # canary and capture-contract assertions
pnpm contracts:check  # published JSON Schemas match the Zod source
```

The domain packages have no dependency on Chrome, the network, or a model — `pnpm test` runs the whole thing in Node.

### Layout

```text
apps/extension/       MV3 extension: capture adapters, storage, UI
packages/
  core-domain/        entities, wire contracts, ports, pure invariants
  capture-engine/     content policy, ingest boundary, Visit construction
  thread-engine/      candidate retrieval, decision providers, assignment
  context-broker/     deterministic, cited, token-bounded agent handoff
  test-fixtures/      synthetic fixtures and privacy canaries
contracts/            generated JSON Schemas — the published wire format
docs/adr/             architecture decisions
docs/privacy/         the capture contract
```

Browser APIs, storage, and classifiers all sit behind ports defined in `core-domain`. The rule that keeps it that way: **no vendor type may appear in a domain package's public surface.**

## Contributing

Start with [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`docs/adr/ADR-001-local-first.md`](docs/adr/ADR-001-local-first.md).

One rule above the others: **if a change would widen what gets captured, it needs an ADR before it needs an implementation.** The stricter privacy reading always wins.

## Licence

[Apache-2.0](LICENSE). The local trust boundary — extension, database, schemas, import/export, classifier, and the privacy tests — is open and stays open. "JevTabs" as a name is handled separately from the code licence; see [`TRADEMARKS.md`](TRADEMARKS.md).
