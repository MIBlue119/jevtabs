# Architecture decision records

An ADR is written when a decision would be expensive to reverse, and it is written _before_ the implementation rather than after.

The rule that matters most: **a change that widens what JevTabs captures needs an ADR before it needs code.** See [`../privacy/CAPTURE_CONTRACT.md`](../privacy/CAPTURE_CONTRACT.md).

| ADR                                              | Decision                                               |
| ------------------------------------------------ | ------------------------------------------------------ |
| [001](ADR-001-local-first.md)                    | Local-first, with no server in the capture path        |
| [002](ADR-002-visit-is-the-unit.md)              | The Visit is the unit of classification, not the Tab   |
| [003](ADR-003-heuristic-first-classification.md) | Heuristic classification first, behind a provider seam |
| [004](ADR-004-context-pack-before-mcp.md)        | Ship the Context Pack in Phase 1; defer MCP to Phase 3 |

## Source-of-truth order

When documents disagree:

1. JSON schemas in [`contracts/`](../../contracts) — wire shapes.
2. ADRs — accepted architectural constraints.
3. [`../privacy/CAPTURE_CONTRACT.md`](../privacy/CAPTURE_CONTRACT.md) — what may be captured.
4. [`../ROADMAP.md`](../ROADMAP.md) — sequencing and gates.
5. The mockup in [`../assets/`](../assets) — visual intent only, never business logic.

The stricter privacy rule always wins.

## Format

Context (what forced a decision) → Decision (what we chose, stated plainly) → Consequences (what it buys, and what it costs — both) → Alternatives considered (and why they lost).

Be specific about the costs. An ADR that lists only benefits is advocacy, not a record.
