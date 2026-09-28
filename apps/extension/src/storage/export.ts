import { toTimestamp, type Clock } from '@jevtabs/core-domain';
import { KV_KEYS, readKv, type JevTabsDatabase } from './db.js';
import { loadSettings } from './repository.js';

/**
 * Export and import.
 *
 * Being able to leave is part of the promise, so the export is the whole
 * knowledge layer in a documented shape — not a screenshot of it. Raw events
 * are excluded by default: they are the largest and least useful part of the
 * archive, and re-importing them elsewhere would move a precise record of
 * someone's attention into a file they might mail to themselves.
 */

export const EXPORT_FORMAT = 'jevtabs.export.v1' as const;

export interface ExportBundle {
  readonly format: typeof EXPORT_FORMAT;
  readonly schemaVersion: 1;
  readonly exportedAt: string;
  readonly counts: Record<string, number>;
  readonly threads: unknown[];
  readonly evidence: unknown[];
  readonly findings: unknown[];
  readonly checkpoints: unknown[];
  readonly artifacts: unknown[];
  readonly pages: unknown[];
  readonly visits: unknown[];
  readonly memberships: unknown[];
  /** Present only when the caller explicitly asked for the raw tape. */
  readonly events?: unknown[];
}

export async function exportAll(
  database: JevTabsDatabase,
  clock: Clock,
  options: { includeRawEvents?: boolean } = {},
): Promise<ExportBundle> {
  const [threads, evidence, findings, checkpoints, artifacts, pages, visits, memberships] =
    await Promise.all([
      database.threads.toArray(),
      database.evidence.toArray(),
      database.findings.toArray(),
      database.checkpoints.toArray(),
      database.artifacts.toArray(),
      database.pages.toArray(),
      database.visits.toArray(),
      database.memberships.toArray(),
    ]);

  const bundle: ExportBundle = {
    format: EXPORT_FORMAT,
    schemaVersion: 1,
    exportedAt: toTimestamp(clock.now()),
    counts: {
      threads: threads.length,
      evidence: evidence.length,
      findings: findings.length,
      checkpoints: checkpoints.length,
      pages: pages.length,
      visits: visits.length,
    },
    threads,
    evidence,
    findings,
    checkpoints,
    artifacts,
    pages,
    visits,
    memberships,
  };

  if (options.includeRawEvents === true) {
    return { ...bundle, events: await database.events.toArray() };
  }
  return bundle;
}

/** Human-readable export: what someone actually wants to keep or paste. */
export async function exportMarkdown(database: JevTabsDatabase, clock: Clock): Promise<string> {
  const threads = (await database.threads.toArray()).sort((a, b) =>
    a.lastActivityAt < b.lastActivityAt ? 1 : -1,
  );
  const lines: string[] = ['# JevTabs export', '', `Exported ${toTimestamp(clock.now())}.`, ''];

  for (const thread of threads) {
    const evidence = await database.evidence.where('threadId').equals(thread.threadId).toArray();
    const findings = await database.findings.where('threadId').equals(thread.threadId).toArray();
    const checkpoints = await database.checkpoints
      .where('threadId')
      .equals(thread.threadId)
      .toArray();

    lines.push(`## ${thread.title}`, '');
    lines.push(
      `*${thread.status}* · ${evidence.length} sources · updated ${thread.lastActivityAt}`,
      '',
    );
    if (thread.intent !== '') lines.push(`**Intent.** ${thread.intent}`, '');

    const confirmed = findings.filter((finding) => finding.state === 'confirmed');
    if (confirmed.length > 0) {
      lines.push('### Findings', '');
      for (const finding of confirmed) {
        lines.push(`- **${finding.text}**${finding.detail === '' ? '' : ` — ${finding.detail}`}`);
      }
      lines.push('');
    }

    const latest = checkpoints.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    if (latest !== undefined) {
      lines.push('### Where this was left off', '');
      lines.push(`**${latest.title}**`);
      if (latest.nextAction !== '') lines.push('', `Next action: ${latest.nextAction}`);
      if (latest.openQuestions.length > 0) {
        lines.push('', 'Open questions:');
        for (const question of latest.openQuestions) lines.push(`- ${question}`);
      }
      lines.push('');
    }

    if (evidence.length > 0) {
      lines.push('### Sources', '');
      for (const row of evidence)
        lines.push(`- [${row.title || row.url}](${row.url}) — *${row.role}*`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/** Everything the "inspect what is stored" panel shows. */
export async function inspectStorage(
  database: JevTabsDatabase,
  clock: Clock,
): Promise<{
  tables: { name: string; rows: number }[];
  settings: Awaited<ReturnType<typeof loadSettings>>;
  captureSessionId: string | null;
  droppedSignals: number;
}> {
  const tables = await Promise.all(
    (
      [
        'events',
        'pages',
        'visits',
        'threads',
        'memberships',
        'evidence',
        'findings',
        'checkpoints',
        'reviews',
        'artifacts',
        'tombstones',
      ] as const
    ).map(async (name) => ({ name, rows: await database.table(name).count() })),
  );

  const session = await readKv<{ captureSessionId: string }>(database, KV_KEYS.captureSession);
  const loss = await readKv<number>(database, KV_KEYS.lossCounter);

  return {
    tables,
    settings: await loadSettings(database, clock),
    captureSessionId: session?.captureSessionId ?? null,
    droppedSignals: loss ?? 0,
  };
}

/** Irreversible, and worded that way everywhere it is offered. */
export async function eraseEverything(database: JevTabsDatabase): Promise<void> {
  await database.transaction('rw', database.tables, async () => {
    for (const table of database.tables) await table.clear();
  });
}
