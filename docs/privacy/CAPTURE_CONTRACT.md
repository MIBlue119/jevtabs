# The capture contract

This document is the authority on what JevTabs may record. It binds the code, not the other way round: if an implementation disagrees with this file, the implementation is wrong.

Two rules govern how it changes:

1. **Widening requires an ADR.** A change that lets JevTabs record something it could not record before is an architectural decision, not an implementation detail.
2. **The stricter reading wins.** Where a rule admits two readings, the one that records less is the correct one.

---

## What is never collected

No setting enables any of these. There is no field in the stored schema that could hold them, which is asserted by [`test/contracts/json-schema.test.ts`](../../test/contracts/json-schema.test.ts).

| Category     | Detail                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------- |
| Input        | Keystrokes, `input`, `textarea`, and `contenteditable` values, password fields, payment details |
| Credentials  | Cookies, authorization headers, session tokens, API keys, bearer tokens                         |
| Clipboard    | Clipboard contents. The _fact_ that a copy happened is recorded; what was copied is not         |
| Incognito    | Any activity in an incognito window, unconditionally                                            |
| Page content | Page bodies, hidden DOM, screenshots, `innerText` dumps                                         |
| URL detail   | Fragments, unconditionally. Query values, unless a parameter is explicitly allowlisted          |
| Network      | Request or response bodies, headers, timings                                                    |

JevTabs requests no `webRequest`, `history`, `cookies`, `clipboardRead`, `debugger`, `nativeMessaging`, or `browsingData` permission. It could not collect most of the above if it tried, which is the point: the permission list is a stronger guarantee than a promise, and [`apps/extension/test/manifest.test.ts`](../../apps/extension/test/manifest.test.ts) fails if it widens.

## What is collected

### Browser events

The complete list is the `BrowserEvent` union in [`packages/core-domain/src/schemas/events.ts`](../../packages/core-domain/src/schemas/events.ts). Every variant carries only:

- a normalized URL and a redacted page title;
- a tab and window identifier, which are per-session integers;
- a coarse navigation cause (`link`, `typed`, `reload`, …) as the browser reports it;
- timestamps;
- for interactions, one of four enum values — `scroll`, `selection`, `copy`, `media_playback`.

An interaction event says _that_ something happened. It carries no selection, no clipboard content, no coordinates, no element, and no text.

### Derived records

Visits, Threads, Evidence, Findings, Checkpoints, and Review items. All of them reference Pages by id; none introduces a new capture surface.

### Excerpts

An Evidence record has an optional `excerpt` field. It is populated **only** by an explicit human save action. Nothing in the capture path writes to it, and JevTabs does not scrape page bodies to fill it.

---

## URL normalization

Normalization is a privacy boundary, implemented in [`packages/core-domain/src/url.ts`](../../packages/core-domain/src/url.ts).

| Rule                                               | Reason                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Fragment dropped unconditionally                   | Never reaches a server, routinely carries OAuth tokens                                   |
| Query values dropped by default                    | Carry session tokens, reset codes, one-time links, personal identifiers                  |
| URLs with credentials rejected entirely            | `https://user:token@host/` — the credential _is_ the payload; stripping it is not enough |
| Non-`http(s)` schemes rejected                     | `file:`, `data:`, `chrome:`, `chrome-extension:`, `about:`, `javascript:`, …             |
| Host lowercased, `www.` and default ports stripped | Identity, not privacy — but it keeps one page from becoming four                         |

`keepDocumentQueryParams` is an opt-in setting that preserves a small allowlist of document-identifying parameters (`v`, `id`, `page`, `p`, `issue`, `pull`). It is off by default and never covers anything credential-shaped.

## Denied surfaces

Built-in rules in [`packages/capture-engine/src/deny-rules.ts`](../../packages/capture-engine/src/deny-rules.ts) refuse authentication, password-manager, payment, banking, health, and identity surfaces before anything is stored.

These rules are a floor, not a guarantee. No list enumerates every sensitive page on the web. They are paired with:

- a capture contract that records no page content in the first place;
- per-domain exclusions, which also erase what was already recorded for that domain;
- a global pause and a master off switch.

A rule is added when a false positive is cheap (one page is not recorded) and a false negative is expensive (a credential-bearing URL is).

## Title redaction

Titles occasionally carry what URLs are forbidden to — `"Your verification code is 483920"`. Patterns matching one-time codes, JWTs, API keys, and AWS access key ids are replaced with `[redacted]` before storage.

---

## Retention

| Data                                                 | Default               | Configurable         |
| ---------------------------------------------------- | --------------------- | -------------------- |
| Raw interaction events                               | 30 days               | Yes                  |
| Visits never promoted to Evidence                    | 30 days               | Yes                  |
| Confirmed Evidence, Findings, Checkpoints, decisions | Until you delete them | No — this is a floor |

Retention expires the raw tape and work that never became work. It never touches something a human confirmed.

## Deletion

Deleting a Thread, excluding a domain, or erasing everything removes the searchable content immediately and writes a tombstone. **A tombstone records that a deletion happened, never what was deleted** — it carries an entity kind, an id, a timestamp, and a reason.

Excluding a domain also purges its existing Pages, Visits, events, Evidence, memberships, and review items. "Stop watching this" that left the watching behind would not be an honest control.

## Telemetry

There is none. JevTabs makes no network request in the capture path, has no analytics, no crash reporter, and no account.

Were telemetry ever added, it would be opt-in and could not include URLs, titles, page text, search queries, intent text, excerpts, embeddings, or Context Pack contents. That is a constraint on a hypothetical, not a plan.

---

## Untrusted source content

Every piece of text that originated inside a web page is tagged `untrusted_source_content` and stays tagged through storage, export, and any hand-off.

The rule this encodes: **text inside a page is evidence about the world, never an instruction to follow.** It cannot authorize a tool, widen a scope, confirm a proposal, or change a policy. A Context Pack renders every excerpt inside an explicit untrusted-source frame with its origin attached, and [`packages/test-fixtures/src/canaries.ts`](../../packages/test-fixtures/src/canaries.ts) carries adversarial fixtures whose visible text tries to do exactly that.

## Agent access

Through the Phase 1 workspace, an agent gets exactly what a person copies into it — a Context Pack, assembled locally, cited, token-bounded, and explicit about what it omitted.

Two asymmetries are deliberate and will survive into the MCP phase:

- **Proposals are inert.** Anything an agent contributes is `proposed` until a human confirms it. An agent cannot confirm its own proposal, which is what stops it laundering a guess into evidence by proposing it and reading it back.
- **Unconfirmed content is withheld and counted.** A pack reports what it did not include, so an agent can distinguish "there is nothing" from "you were not shown it".

## How this is enforced

| Mechanism                                          | Location                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Canary assertions on absence of specific bytes     | [`test/privacy`](../../test/privacy)                                                                               |
| No forbidden field exists in any stored shape      | [`test/contracts/json-schema.test.ts`](../../test/contracts/json-schema.test.ts)                                   |
| Install-time permissions cannot widen              | [`apps/extension/test/manifest.test.ts`](../../apps/extension/test/manifest.test.ts)                               |
| Policy refuses each denied surface                 | [`packages/capture-engine/test/content-policy.test.ts`](../../packages/capture-engine/test/content-policy.test.ts) |
| Exclusion erases; deletion leaves only a tombstone | [`apps/extension/test/repository.test.ts`](../../apps/extension/test/repository.test.ts)                           |

The privacy suite runs as its own CI job so a regression is unmistakable rather than one line in a combined summary.

## Reporting a problem

If you find something captured, stored, or exported that this document says should not be, please use GitHub's private vulnerability reporting rather than a public issue, and do not include real URLs or personal data — a maintainer will reproduce it with synthetic fixtures.
