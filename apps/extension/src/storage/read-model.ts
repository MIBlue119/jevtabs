import type { Page, Thread, Visit } from '@jevtabs/core-domain';
import type { ThreadProfile, ThreadReadModel } from '@jevtabs/thread-engine';
import type { BrokerReadModel } from '@jevtabs/context-broker';
import type { JevTabsDatabase } from './db.js';

/**
 * Dexie implementations of the read ports. Deliberately thin: every ranking or
 * policy decision belongs in the engines, so that swapping this file for the
 * SQLite companion changes performance and nothing else.
 */

export function createThreadReadModel(database: JevTabsDatabase): ThreadReadModel {
  return {
    async candidateThreads({ limit }): Promise<ThreadProfile[]> {
      const threads = await database.threads
        .where('status')
        .anyOf(['active', 'dormant', 'paused'])
        .reverse()
        .sortBy('lastActivityAt');

      const selected = threads.slice(0, limit);
      return Promise.all(selected.map((thread) => profileOf(database, thread)));
    },

    async page(pageId: string): Promise<Page | null> {
      return (await database.pages.get(pageId)) ?? null;
    },

    async threadIdsForPage(pageId: string): Promise<string[]> {
      const rows = await database.evidence.where('pageId').equals(pageId).toArray();
      return [...new Set(rows.map((row) => row.threadId))];
    },

    async visit(visitId: string): Promise<Visit | null> {
      return (await database.visits.get(visitId)) ?? null;
    },
  };
}

export async function profileOf(database: JevTabsDatabase, thread: Thread): Promise<ThreadProfile> {
  const evidence = await database.evidence.where('threadId').equals(thread.threadId).toArray();
  const pageIds = [...new Set(evidence.map((row) => row.pageId))];
  const pages = await database.pages.bulkGet(pageIds);

  const hostCounts: Record<string, number> = {};
  for (const page of pages) {
    if (page === undefined) continue;
    hostCounts[page.host] = (hostCounts[page.host] ?? 0) + 1;
  }

  const confirmed = await database.findings
    .where('threadId')
    .equals(thread.threadId)
    .filter((finding) => finding.state === 'confirmed')
    .first();

  return {
    thread,
    summary: thread.intent !== '' ? thread.intent : (confirmed?.text ?? thread.title),
    confirmedPageIds: pageIds,
    hostCounts,
  };
}

export function createBrokerReadModel(database: JevTabsDatabase): BrokerReadModel {
  return {
    async thread(threadId) {
      return (await database.threads.get(threadId)) ?? null;
    },
    async findings(threadId) {
      const rows = await database.findings.where('threadId').equals(threadId).toArray();
      return rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    },
    async evidence(threadId) {
      const rows = await database.evidence.where('threadId').equals(threadId).toArray();
      // Primary sources first, then implementation, then everything else.
      const rank = { primary: 0, implementation: 1, evidence: 2, reference: 3, search: 4 };
      return rows.sort(
        (a, b) =>
          rank[a.role] - rank[b.role] ||
          (a.capturedAt < b.capturedAt ? 1 : -1) ||
          (a.evidenceId < b.evidenceId ? -1 : 1),
      );
    },
    async checkpoints(threadId) {
      return database.checkpoints.where('threadId').equals(threadId).toArray();
    },
    async timeline(threadId, limit) {
      const evidence = await database.evidence.where('threadId').equals(threadId).toArray();
      const visits = await database.visits.bulkGet(evidence.map((row) => row.visitId));
      const out: { visit: Visit; page: Page }[] = [];
      for (const visit of visits) {
        if (visit === undefined) continue;
        const page = await database.pages.get(visit.pageId);
        if (page === undefined) continue;
        out.push({ visit, page });
      }
      return out.sort((a, b) => (a.visit.startedAt < b.visit.startedAt ? 1 : -1)).slice(0, limit);
    },
  };
}
