# ADR-004: Ship the Context Pack in Phase 1; defer MCP to Phase 3

- **Status:** Accepted
- **Date:** 2026-09-18

## Context

The plan places the MCP server in Phase 3 and is emphatic that Phases 0 and 1 should not start it: _"Do not add JEV, MCP, Cloudflare, billing, or Tauri until capture lifecycle, exclusions, idempotent persistence, inspection UI, and privacy tests pass."_

That instruction is about the transport and its consequences — scope enforcement, per-client identity, audit records, revocation, prompt-injection isolation across a process boundary. All of it is real work and none of it should happen before the core loop is known to be useful.

But the _assembly_ problem is separate from the transport problem, and it is the payoff a person feels. "I stopped working on this on Tuesday, here is what I had" is the reason to keep Threads at all. Without some hand-off, Phase 1 asks people to maintain a knowledge base whose value arrives two phases later.

## Decision

**Implement `ContextBroker` in Phase 1 as a local, deterministic assembly with copy and download. Ship no transport, no server, no port, and no client credential.**

What is in:

- Deterministic assembly: same snapshot, request, and versions produce a byte-identical pack.
- Provenance on every factual item — a source, a human confirmation, or an explicit inference label.
- A token budget, with what was dropped reported rather than silently trimmed.
- An omission list covering every reason something was withheld.
- Markdown rendering with an untrusted-source banner.
- Copy to clipboard and download to a file. That is the whole delivery mechanism.

What is deferred to Phase 3:

- The stdio MCP server and its tool schemas.
- Per-client scopes, identity, and audit records.
- Agent writeback (`propose_finding`, `attach_artifact`) over a wire.
- Revocation.

## Why this is not scope creep

The broker is a pure function over local data, in a package with no network dependency, tested without a browser or a model. It opens none of the questions MCP opens: there is no client to authenticate, no scope to enforce across a boundary, no port to leave unauthenticated, and no channel through which a malicious page could reach a tool.

When the MCP server is built, it becomes one more caller of this same function. Building it now means Phase 3 is a transport with scope enforcement rather than a transport _and_ an assembly algorithm — and the algorithm is the part where the invariants live.

## The asymmetries, established now

Two rules are cheaper to build in than to retrofit, so they exist in Phase 1 even though no agent can reach them yet:

**Unconfirmed proposals are withheld and counted.** A pack never includes a `proposed` finding — including one an agent itself contributed. Otherwise an agent could launder a guess into evidence by proposing it and reading it back as fact.

**Omissions are part of the document.** An agent that cannot distinguish "there is nothing" from "you were not shown it" will confidently fill the gap. The pack therefore reports what it withheld and why, in the rendered Markdown as well as the structured form.

## Consequences

**Phase 1 delivers its own payoff.** Someone can dogfood the full loop — browse, correct, checkpoint, hand off — and find out whether Threads are worth keeping, which is precisely the question the Phase 1 gate asks.

**The hand-off is manual.** Copy and paste. That is a real limitation and the honest one for this phase.

**The contract is published early.** `context-pack.schema.json` is generated and committed now, so the Phase 3 transport has a wire format to conform to rather than invent.

## Alternatives considered

**Ship MCP in Phase 1.** Rejected. It front-loads the hardest security work — scope enforcement, injection isolation, revocation — before knowing whether anyone wants the data it would serve.

**Ship nothing agent-facing in Phase 1.** Rejected. It would make the Phase 1 gate unanswerable: "do users reuse exported context?" cannot be measured if there is no way to export it.

**A localhost HTTP endpoint as an interim transport.** Firmly rejected. An unauthenticated localhost port is reachable by every page in the browser and every process on the machine. The plan rules it out and it is right to.
