# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-09-29

First alpha. The capture loop, classification, review, Checkpoints, and the
workspace work end to end, locally, with no network.

### Added

- **Capture** — foreground-attention sessionization built on Visits rather than
  tabs. Background and stale tabs produce no Visit and accrue no time. Spans are
  capped at the idle timeout so walking away cannot inflate attention.
- **Privacy** — a content policy that refuses authentication, banking, health,
  identity, password-manager, and payment surfaces; drops fragments
  unconditionally and query values by default; rejects credential-bearing URLs
  outright; and redacts one-time codes, JWTs, and API keys out of titles.
  Incognito activity is never recorded.
- **Progressive permissions** — no host permission at install. Interaction
  signals are opt-in, revocable, and report four booleans, never content.
- **Classification** — candidate retrieval over four explainable signals and a
  deterministic heuristic provider behind the `DecisionProvider` seam. Low
  confidence produces a review item, never an invented assignment.
- **Corrections** — append-only revisions that keep the superseded decision and
  its provider stamp, so classifier accuracy stays measurable.
- **Threads** — active, dormant, paused, and completed lifecycles, with
  reactivation instead of forking a duplicate.
- **Checkpoints** — intent, key sources, settled findings, open questions, and
  next action.
- **Context Packs** — deterministic, cited, token-bounded assembly with an
  explicit omission list, rendered to Markdown with an untrusted-source banner.
  Local only; no transport.
- **Surfaces** — popup, side panel, and a workspace with Today, Activity Inbox,
  Threads, Thread detail, Agent Context, and Settings.
- **Export and deletion** — JSON and Markdown export, per-domain exclusion that
  erases what it excludes, and deletion that leaves a tombstone recording that a
  deletion happened but never what it said.
- **Contracts** — JSON Schemas generated from the Zod definitions and checked in
  CI for drift.
- **Tests** — 187 across unit, contract, privacy, and extension suites,
  including canary assertions on the absence of specific bytes, a manifest test
  that fails if install-time permissions widen, and crash-recovery tests that
  kill the service worker after every single event.

[Unreleased]: https://github.com/MIBlue119/jevtabs/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/MIBlue119/jevtabs/releases/tag/v0.1.0
