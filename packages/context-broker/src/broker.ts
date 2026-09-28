import {
  type Clock,
  type ContextBroker,
  type ContextItem,
  type ContextOmission,
  type ContextPack,
  type ContextRequest,
  type IdGenerator,
  estimateTokens,
  fromTimestamp,
  toTimestamp,
  truncate,
} from '@jevtabs/core-domain';
import type { BrokerReadModel } from './store.js';

/**
 * The Context Broker.
 *
 * It answers one question — "what does this agent actually need?" — under
 * three hard rules:
 *
 *   1. Every factual item carries provenance or an explicit inference label.
 *   2. Everything left out is counted and reported, so an agent can tell the
 *      difference between "there is nothing" and "you were not shown it".
 *   3. Assembly is deterministic: the same snapshot, request, and versions
 *      produce a byte-identical pack. Ranking ties break on id, never on
 *      iteration order.
 *
 * Note the asymmetry in what an agent may read: unconfirmed proposals —
 * including anything an agent itself suggested — are withheld and counted.
 * Otherwise an agent could launder its own guess into evidence by proposing it
 * and reading it back.
 */

export const BROKER_VERSION = '1.0.0';
export const POLICY_VERSION = '1.0.0';

export interface BrokerOptions {
  readonly store: BrokerReadModel;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Cap on Visits pulled into a `full_trace` pack, per Thread. */
  readonly timelineLimit?: number;
}

/** Lower sorts first. Intent and human-confirmed knowledge outrank everything. */
const KIND_PRIORITY: Record<ContextItem['kind'], number> = {
  intent: 0,
  checkpoint: 1,
  finding: 2,
  question: 3,
  source: 4,
  timeline: 5,
};

function withTokens(item: Omit<ContextItem, 'estimatedTokens'>): ContextItem {
  return { ...item, estimatedTokens: estimateTokens(item.text) };
}

function bump(omissions: Map<ContextOmission['reason'], number>, reason: ContextOmission['reason'], by = 1): void {
  omissions.set(reason, (omissions.get(reason) ?? 0) + by);
}

export function createContextBroker(options: BrokerOptions): ContextBroker {
  const timelineLimit = options.timelineLimit ?? 20;

  return {
    async build(request: ContextRequest): Promise<ContextPack> {
      const snapshotAt = toTimestamp(options.clock.now());
      const omissions = new Map<ContextOmission['reason'], number>();
      const threads: ContextPack['threads'] = [];
      const ranked: { item: ContextItem; threadRank: number; recency: number; key: string }[] = [];

      for (const [threadRank, threadId] of request.threadIds.entries()) {
        const thread = await options.store.thread(threadId);
        if (thread === null) {
          bump(omissions, 'scope_not_granted');
          continue;
        }
        threads.push({ threadId, title: thread.title, status: thread.status });

        const push = (item: Omit<ContextItem, 'estimatedTokens'>, at: string, key: string): void => {
          ranked.push({
            item: withTokens(item),
            threadRank,
            recency: fromTimestamp(at),
            key,
          });
        };

        if (thread.intent.trim() !== '') {
          push(
            {
              kind: 'intent',
              text: `${thread.title} — ${thread.intent}`,
              provenance: thread.confirmed
                ? { type: 'human', confirmedAt: thread.updatedAt }
                : { type: 'inference', by: 'thread-engine', note: 'intent inferred from browsing' },
            },
            thread.updatedAt,
            `intent:${threadId}`,
          );
        }

        const checkpoints = (await options.store.checkpoints(threadId)).sort(
          (a, b) => fromTimestamp(b.createdAt) - fromTimestamp(a.createdAt),
        );
        const latest = checkpoints[0];
        if (latest !== undefined) {
          push(
            {
              kind: 'checkpoint',
              text: [
                `Checkpoint: ${latest.title}`,
                latest.nextAction === '' ? null : `Next action: ${latest.nextAction}`,
              ]
                .filter((line): line is string => line !== null)
                .join('\n'),
              provenance: { type: 'human', confirmedAt: latest.createdAt },
            },
            latest.createdAt,
            `checkpoint:${latest.checkpointId}`,
          );

          if (request.include.openQuestions && request.detail !== 'brief') {
            for (const [index, question] of latest.openQuestions.entries()) {
              push(
                {
                  kind: 'question',
                  text: question,
                  provenance: { type: 'human', confirmedAt: latest.createdAt },
                },
                latest.createdAt,
                `question:${latest.checkpointId}:${index}`,
              );
            }
          }
        }

        if (request.include.findings) {
          const findings = await options.store.findings(threadId);
          const evidenceById = new Map(
            (await options.store.evidence(threadId)).map((item) => [item.evidenceId, item]),
          );
          for (const finding of findings) {
            if (finding.state !== 'confirmed') {
              if (finding.state === 'proposed') bump(omissions, 'unconfirmed_proposal');
              continue;
            }
            const source = finding.sourceRefs
              .map((ref) => evidenceById.get(ref))
              .find((item) => item !== undefined);
            push(
              {
                kind: 'finding',
                text: finding.detail === '' ? finding.text : `${finding.text}\n${finding.detail}`,
                provenance:
                  source === undefined
                    ? { type: 'human', confirmedAt: finding.updatedAt }
                    : {
                        type: 'source',
                        evidenceId: source.evidenceId,
                        url: source.url,
                        title: source.title,
                        capturedAt: source.capturedAt,
                        trust: 'untrusted_source_content',
                      },
              },
              finding.updatedAt,
              `finding:${finding.findingId}`,
            );
          }
        }

        if (request.include.sourceExcerpts && request.detail !== 'brief') {
          const evidence = await options.store.evidence(threadId);
          for (const item of evidence) {
            push(
              {
                kind: 'source',
                text: `${item.title} — ${item.url}${item.excerpt === null ? '' : `\n> ${truncate(item.excerpt, 400)}`}`,
                provenance: {
                  type: 'source',
                  evidenceId: item.evidenceId,
                  url: item.url,
                  title: item.title,
                  capturedAt: item.capturedAt,
                  trust: 'untrusted_source_content',
                },
              },
              item.capturedAt,
              `source:${item.evidenceId}`,
            );
          }
        } else if (request.include.sourceExcerpts) {
          bump(omissions, 'detail_level', (await options.store.evidence(threadId)).length);
        }

        if (request.include.rawActivity) {
          if (request.detail === 'full_trace') {
            const rows = await options.store.timeline(threadId, timelineLimit);
            for (const row of rows) {
              push(
                {
                  kind: 'timeline',
                  text: `${row.visit.startedAt} · ${Math.round(row.visit.foregroundMs / 1000)}s · ${row.page.title} (${row.page.url})`,
                  provenance: {
                    type: 'inference',
                    by: 'capture-engine',
                    note: 'foreground attention interval',
                  },
                },
                row.visit.startedAt,
                `timeline:${row.visit.visitId}`,
              );
            }
          } else {
            bump(omissions, 'detail_level');
          }
        }
      }

      // Deterministic ordering: kind, then requested thread order, then recency,
      // then a stable key so identical timestamps never reorder between runs.
      ranked.sort(
        (a, b) =>
          KIND_PRIORITY[a.item.kind] - KIND_PRIORITY[b.item.kind] ||
          a.threadRank - b.threadRank ||
          b.recency - a.recency ||
          (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
      );

      const items: ContextItem[] = [];
      let used = 0;
      for (const entry of ranked) {
        if (used + entry.item.estimatedTokens > request.tokenBudget) {
          bump(omissions, 'token_budget');
          continue;
        }
        used += entry.item.estimatedTokens;
        items.push(entry.item);
      }

      return {
        schemaVersion: 1,
        packId: options.ids.next(),
        builtAt: snapshotAt,
        request,
        threads,
        items,
        omissions: [...omissions.entries()]
          .map(([reason, count]) => ({ reason, count }))
          .sort((a, b) => (a.reason < b.reason ? -1 : 1)),
        estimatedTokens: used,
        determinism: {
          brokerVersion: BROKER_VERSION,
          policyVersion: POLICY_VERSION,
          snapshotAt,
        },
      };
    },
  };
}
