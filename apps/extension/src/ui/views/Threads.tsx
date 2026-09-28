import { useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ThreadStatus } from '@jevtabs/core-domain';
import { createManualThread } from '../../storage/repository.js';
import { relativeTime, threadOverviews, uiContext } from '../data.js';
import { Dot, Empty, StatusChip } from '../components.jsx';

const FILTERS: { id: string; label: string; statuses?: ThreadStatus[] }[] = [
  { id: 'all', label: '全部 All' },
  { id: 'active', label: 'Active', statuses: ['active'] },
  { id: 'dormant', label: 'Dormant', statuses: ['dormant', 'paused'] },
  { id: 'completed', label: 'Completed', statuses: ['completed', 'archived'] },
];

/**
 * Threads.
 *
 * Not a folder tree. A Thread's lifecycle — active, dormant, paused, completed
 * — is the primary organizing idea, because the thing people actually need is
 * "what was I doing, and can I pick it up?" rather than "where did I file it?".
 */
export function Threads({ onOpenThread }: { onOpenThread: (id: string) => void }): ReactNode {
  const [filter, setFilter] = useState('all');
  const statuses = FILTERS.find((entry) => entry.id === filter)?.statuses;
  const overviews = useLiveQuery(() => threadOverviews(statuses), [filter], []);

  async function addThread(): Promise<void> {
    const title = window.prompt('Thread title');
    if (title === null || title.trim() === '') return;
    const thread = await createManualThread(uiContext(), title.trim());
    onOpenThread(thread.threadId);
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <header
        className="row"
        style={{ justifyContent: 'space-between', gap: 20, alignItems: 'flex-end' }}
      >
        <div className="stack" style={{ gap: 6 }}>
          <p className="eyebrow">Research threads</p>
          <h1>跨時間保存，而不是把 tabs 塞進資料夾</h1>
          <p className="muted">
            Thread 可以暫停、休眠、重新啟動。 Threads pause, go dormant, and reactivate — they do
            not get filed away and forgotten.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={() => void addThread()}>
          ＋ 新增 Thread
        </button>
      </header>

      <div className="row" style={{ gap: 6 }}>
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            className={`btn ${filter === entry.id ? 'btn-primary' : 'btn-ghost'} btn-sm`}
            onClick={() => setFilter(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {overviews.length === 0 ? (
        <section className="panel">
          <Empty
            title="還沒有 Thread"
            hint="Threads appear once JevTabs has seen enough sustained attention to propose one."
          />
        </section>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
            gap: 14,
          }}
        >
          {overviews.map((overview) => (
            <article
              className="panel"
              key={overview.thread.threadId}
              style={{ cursor: 'pointer' }}
              onClick={() => onOpenThread(overview.thread.threadId)}
            >
              <div
                style={{
                  height: 74,
                  borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
                  background: `var(--${overview.thread.accent}-soft, var(--gray-soft))`,
                  padding: '12px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <StatusChip status={overview.thread.status} />
                  {overview.confidence === null ? null : (
                    <small className="muted">
                      {Math.round(overview.confidence * 100)}% confidence
                    </small>
                  )}
                </div>
                <small className="muted">
                  {overview.sourceCount} sources
                  {overview.checkpointCount > 0 ? ` · ${overview.checkpointCount} checkpoints` : ''}
                </small>
              </div>

              <div className="panel-body stack" style={{ gap: 8 }}>
                <div className="row" style={{ gap: 8 }}>
                  <Dot accent={overview.thread.accent} />
                  <h2 className="truncate grow">{overview.thread.title}</h2>
                </div>
                <p className="small muted" style={{ minHeight: 34 }}>
                  {overview.thread.intent === ''
                    ? (overview.lastEvidence?.title ?? '尚未加入說明 · no intent recorded yet')
                    : overview.thread.intent}
                </p>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <small className="muted">{relativeTime(overview.thread.lastActivityAt)}</small>
                  {overview.thread.confirmed ? null : <span className="chip">Unconfirmed</span>}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
