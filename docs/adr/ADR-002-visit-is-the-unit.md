# ADR-002: The Visit is the unit of classification, not the Tab

- **Status:** Accepted
- **Date:** 2026-09-18

## Context

Every tab manager classifies tabs. It is the obvious move: a tab is a visible object with a URL and a title, users already think in tabs, and the browser hands you a list of them.

It also does not work, for two reasons that compound.

**A tab is not one thing over time.** The same GitHub repo tab serves "evaluate this library" on Tuesday and "debug our integration" on Friday. Classify the tab and you have to pick one, and you will be wrong half the time.

**An open tab is not attention.** Forty tabs are open. Six are being used. Thirty-four are sediment — things opened once, kept "just in case", or left over from a project that ended in August. Treating them as signal is why tab managers produce lists nobody reads: the noise is the majority of the input.

## Decision

**The unit of classification is the Visit: one interval of meaningful foreground attention on one Page.**

- A **Page** is a normalized URL identity. Content-addressed and stable.
- A **Visit** is an interval of foreground attention on a Page, with the spans, dwell time, activation count, and coarse interaction signals that describe it.
- A **Thread** is the durable intent a Visit gets assigned to.

Two consequences follow directly:

1. **A Visit exists only where foreground attention existed.** A tab that loads in the background produces a Page and no Visit. A tab open for sixteen days without being looked at produces nothing at all. Background time is never counted.
2. **One Page can belong to many Threads, through different Visits.** Tuesday's visit to the repo goes to one Thread; Friday's goes to another. Neither has to be wrong.

### Meaningfulness

A Visit is meaningful when it clears a bar that deliberately rewards deliberate behaviour over elapsed time:

- foreground dwell over the threshold (default 8s), **or**
- the person selected or copied something, **or**
- they came back to it at least three times and dwelled at least half the threshold.

Copying is the strongest short-visit signal there is: nobody copies from a page they are not using.

### Attention spans are capped

Spans close on blur, tab switch, navigation, idle, and tab close. When a span closes it is capped at `lastActivityAt + idleTimeout`, so walking away from the machine with a page in the foreground cannot turn lunch into ninety minutes of "attention". Without this the dwell signal is worthless, because the largest numbers come from the times the person was not there.

## Consequences

**Sessionization becomes the hard part of the system.** It is a pure reducer over an event tape — `packages/capture-engine/src/visit-builder.ts` — with no storage or browser dependency, so it can be tested exhaustively against synthetic tapes. That is where the complexity should live.

**Visit ids must be content-derived.** The MV3 worker can die between the durable write and the fold; recovery re-folds the tail and has to arrive at the same Visit rather than a duplicate. A clock-minted id cannot do that. (The same reasoning later applied to event, membership, evidence, and review ids.)

**"You have 40 tabs open" stops being the product's problem.** JevTabs never closes, moves, or rearranges a tab. It just declines to treat them as evidence of anything.

**The ignored-tab count is a feature.** Showing what was _not_ counted is how the product earns the trust to count anything, so it has a panel on Today rather than being invisible.

## Alternatives considered

**Classify tabs.** Rejected above.

**Classify individual navigations.** Too granular: a single research session becomes forty rows, and the dwell and revisit signals — the ones that actually correlate with intent — are lost because each navigation has almost none.

**Classify time windows ("what were you doing 9–10am?").** Rejected. Real browsing interleaves; an hour usually contains three unrelated things, and a window forces them together.

**Count background time at a discount.** Rejected. It sounds reasonable and is not: the discount is arbitrary, and it reintroduces exactly the noise the Visit model exists to remove. A page you are not looking at is a page you are not looking at.
