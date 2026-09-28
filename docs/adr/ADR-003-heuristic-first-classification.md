# ADR-003: Heuristic classification first, behind a provider seam

- **Status:** Accepted
- **Date:** 2026-09-18

## Context

Assigning a Visit to a Thread is a classification problem, and the tempting move is to reach for a model immediately — it is the part of the product where a model would obviously help.

Doing that first would have made three things impossible at once:

- Testing the domain without a network or a model.
- Knowing whether a model was helping, since there would be nothing to compare against.
- Working offline, or when a provider is slow, rate-limited, or returning nonsense.

It would also have inverted the architecture. The plan is explicit that a classification adapter is _one_ component behind a stable interface — not the database, the domain model, or the product.

## Decision

**Ship a deterministic heuristic classifier first, behind the `DecisionProvider` interface, and treat it permanently as the offline fallback and the accuracy oracle.**

The pipeline:

1. Deterministic deny and exclusion rules.
2. Event sequences become Visits (ADR-002).
3. Candidate retrieval narrows to 3–5 Threads on four named, explainable signals: lexical overlap (0.40), recency (0.20), navigation ancestry (0.25), prior confirmations (0.15).
4. A `DecisionProvider` chooses one candidate, `new_thread`, `noise`, or `review_required`.
5. Calibrated thresholds decide whether to apply, ask, or ignore.
6. Provider name, version, confidence, and rationale are persisted with every assignment.

### The confidence gate applies to assignment, not creation

Assigning a Visit to an _existing_ Thread below `autoAssignConfidence` produces a review item, never a guess: that is the move a classifier gets quietly wrong and a person then has to find and undo.

A proposed _new_ Thread is different. It is created unconfirmed, labelled with its confidence, and is one click to accept or discard. Queueing it for review instead would put an empty Thread behind a modal for no gain.

### Malformed output degrades to review

A provider's response is validated against a schema before it is trusted. A timeout, an offline provider, or a shape we do not recognize produces a review item — never a lost Visit and never a corrupted graph. Treating provider absence as a normal degraded state, rather than an error path, is what makes the seam safe to extend.

### Payload minimization is structural

`VisitFeatures` — the projection a provider sees — carries the title, host, path terms, timings, and coarse signals. There is no field for a page body, because a remote adapter should be physically unable to receive one rather than merely instructed not to ask.

## Consequences

**The domain tests run in Node with no browser, network, or model.** This is the property that keeps iteration fast and CI honest.

**Accuracy becomes measurable.** Corrections are recorded as revisions with the original provider stamp intact, so "how often was the heuristic wrong, and about what?" is a query rather than a guess. Any future adapter has a baseline to beat.

**Explanations match decisions.** The rationale strings shown in the UI are produced by the provider itself, not written by the UI. A paraphrase would drift from the thing it claims to explain.

**The heuristic has a real ceiling.** Lexical overlap does not understand that "ModernBERT semantic routing" and "Perceptron eval" are the same project. That is exactly the case that lands in the Activity Inbox, which is the honest behaviour — and the gap a model adapter would close.

## Alternatives considered

**Model-first.** Rejected: untestable offline, unmeasurable, and it would have shaped the storage and domain around a vendor's response format.

**Embeddings for retrieval from day one.** Deferred, not rejected. The plan is explicit that local embeddings come after lexical retrieval has been measured. `CandidateRetriever` is the seam they slot into, and brute-force vectors are fine at personal scale when the time comes.

**No classification — let people file manually.** Rejected. Manual filing is the thing everyone already fails to do; a tool that requires it has not removed the problem, it has renamed it.
