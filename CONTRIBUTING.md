# Contributing to JevTabs

Thanks for wanting to help. This document covers what you need to know before opening a pull request.

## The one rule that matters most

**A change that widens what gets captured needs an ADR before it needs an implementation.**

JevTabs is a tool people point at their entire browsing life. The only reason that is a reasonable thing to install is the capture contract in [`docs/privacy/CAPTURE_CONTRACT.md`](docs/privacy/CAPTURE_CONTRACT.md). If your change would record a field that contract does not already allow, open an issue describing the decision first. When two readings of a privacy rule are both defensible, the stricter one wins.

## Getting set up

```bash
corepack enable
pnpm install
pnpm test
```

Everything runs in Node. No browser, network, or model is needed for the test suite — that is a property of the architecture, not a coincidence, and it is worth preserving.

## Branching — git flow

| Branch | Purpose |
|---|---|
| `main` | Released, tagged states only. Never committed to directly. |
| `develop` | Integration branch. Feature branches merge here. |
| `feature/*` | One coherent change. Branch from `develop`, merge back with `--no-ff`. |
| `release/*` | Version bump, changelog, final fixes. Merges to `main` **and** back to `develop`. |
| `hotfix/*` | Urgent fix off `main`. Merges to `main` **and** `develop`. |

```bash
git checkout develop && git pull
git checkout -b feature/side-panel-empty-state
# ... work ...
git checkout develop
git merge --no-ff feature/side-panel-empty-state
```

`--no-ff` is not optional: the merge commit is what makes a feature legible in the history a year later.

## Commit messages

Conventional Commits:

```
feat(thread-engine): reactivate dormant threads instead of forking new ones
fix(capture): stop counting foreground time after the machine goes idle
docs(privacy): record why query values are dropped by default
```

Types in use: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `perf`, `build`, `ci`.

## Before you push

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm contracts:check
```

CI runs exactly these. `contracts:check` fails when the committed JSON Schemas have drifted from the Zod definitions — run `pnpm contracts:generate` and commit the result.

## Architectural expectations

- **Ports stay clean.** Browser APIs, storage, and classifiers live behind the interfaces in `@jevtabs/core-domain`. A vendor type must never appear in a domain package's public surface.
- **Raw events and human corrections are immutable.** Derived projections are rebuildable; history is not rewritable. A correction appends a revision — it does not edit the row it replaces.
- **Uncertainty is surfaced, not hidden.** Low confidence produces a review item. It never produces an invented assignment.
- **Replay is idempotent.** Identifiers for anything that can be re-derived from the event log are content-derived, not minted from a clock.
- **Degraded is normal.** A missing provider, a timeout, or malformed output must never lose a Visit.

## Tests

- `packages/*/test` — unit tests for the domain.
- `test/contracts` — every recorded or exported shape round-trips through JSON and re-validates.
- `test/privacy` — canary assertions. These check for the absence of specific bytes.

New capture behaviour needs a privacy test. New stored shapes need a contract test. Fixtures are synthetic: never commit a real browsing history, URL, or title.

## Reporting a security or privacy issue

Please do not open a public issue for a capture leak or a data-exposure bug. Use GitHub's private vulnerability reporting, or contact a maintainer directly.
