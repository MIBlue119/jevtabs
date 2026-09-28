import type { ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { DAY_MS } from '@jevtabs/core-domain';
import { db } from '../../storage/db.js';
import { confirmThread, dismissReview, resolveClassification } from '../../storage/repository.js';
import {
  formatDuration,
  openInbox,
  quickStats,
  recentTimeline,
  relativeTime,
  threadOverviews,
  uiContext,
} from '../data.js';
import { Confidence, Dot, Empty, Rationale, SiteMark, StatusChip } from '../components.jsx';

/**
 * Today.
 *
 * The question this screen answers is "what was I actually doing?", so the
 * current inference leads and everything else supports it. The ignored-tabs
 * panel is load-bearing rather than cosmetic: showing what was *not* counted is
 * how the product earns the trust to count anything at all.
 */
export function Today({
  onOpenThread,
  onGoto,
}: {
  onOpenThread: (id: string) => void;
  onGoto: (view: string) => void;
}): ReactNode {
  const stats = useLiveQuery(() => quickStats(), [], null);
  const timeline = useLiveQuery(() => recentTimeline(Date.now() - DAY_MS, 25), [], []);
  const threads = useLiveQuery(() => threadOverviews(['active']), [], []);
  const inbox = useLiveQuery(() => openInbox(), [], []);
  const ambient = useLiveQuery(
    async () => {
      const since = new Date(Date.now() - DAY_MS).toISOString();
      const visits = await db().visits.where('startedAt').above(since).toArray();
      return visits.filter((visit) => !visit.meaningful).length;
    },
    [],
    0,
  );

  const current = threads[0];
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="stack" style={{ gap: 20 }}>
      <header
        className="row"
        style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 24 }}
      >
        <div className="stack" style={{ gap: 6 }}>
          <p className="eyebrow">{today}</p>
          <h1>你的瀏覽器很混亂，沒關係。</h1>
          <p className="muted">
            JevTabs 正在從注意力軌跡中還原你真正進行的工作。
            <br />
            Reconstructing the work behind the tabs, from where your attention actually went.
          </p>
        </div>
        <div className="row" style={{ gap: 26 }}>
          <Metric value={stats?.activeThreads ?? 0} label="Active threads" />
          <Metric value={stats?.visitsToday ?? 0} label="Meaningful visits" />
          <Metric value={stats?.openReviews ?? 0} label="Need review" accent />
        </div>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.7fr) minmax(280px, 1fr)',
          gap: 18,
        }}
      >
        <div className="stack" style={{ gap: 18 }}>
          <section className="panel">
            <div className="panel-head">
              <div className="stack" style={{ gap: 2 }}>
                <strong>目前推論 · Current inference</strong>
                <small className="muted">
                  根據最近的前景活動 · from recent foreground activity
                </small>
              </div>
            </div>

            {current === undefined ? (
              <Empty
                title="還沒有足夠的活動"
                hint="Browse normally for a few minutes. JevTabs only records foreground attention, so nothing appears until you actually read something."
              />
            ) : (
              <div className="panel-body stack" style={{ gap: 14 }}>
                <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
                  <Dot accent={current.thread.accent} />
                  <div className="grow stack" style={{ gap: 4 }}>
                    <span className="eyebrow">Active thread</span>
                    <h2>{current.thread.title}</h2>
                    <p className="muted small">
                      {current.thread.intent === ''
                        ? `${current.sourceCount} 個來源 · updated ${relativeTime(current.thread.lastActivityAt)}`
                        : current.thread.intent}
                    </p>
                  </div>
                  {current.confidence !== null ? <Confidence value={current.confidence} /> : null}
                </div>

                <div className="row" style={{ gap: 8 }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => onOpenThread(current.thread.threadId)}
                  >
                    查看 Thread
                  </button>
                  {current.thread.confirmed ? null : (
                    <button
                      className="btn btn-primary"
                      onClick={() => void confirmThread(uiContext(), current.thread.threadId)}
                    >
                      確認這個推論 · Confirm
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="panel-body" style={{ borderTop: '1px solid var(--line)' }}>
              <p className="eyebrow" style={{ marginBottom: 10 }}>
                Foreground timeline
              </p>
              {timeline.length === 0 ? (
                <Empty title="今天還沒有記錄到有意義的造訪" />
              ) : (
                <div className="stack" style={{ gap: 2 }}>
                  {timeline.map((entry) => (
                    <div
                      className="row"
                      key={entry.visit.visitId}
                      style={{ gap: 10, padding: '7px 0' }}
                    >
                      <SiteMark host={entry.page.host} accent={entry.thread?.accent} />
                      <div className="grow stack" style={{ gap: 1, minWidth: 0 }}>
                        <span className="truncate">{entry.page.title || entry.page.host}</span>
                        <small className="muted truncate">
                          {entry.page.host} · {formatDuration(entry.visit.foregroundMs)}
                          {entry.visit.signals.activationCount > 1
                            ? ` · 切回 ${entry.visit.signals.activationCount} 次`
                            : ''}
                          {entry.visit.signals.copied ? ' · 複製了內容' : ''}
                        </small>
                      </div>
                      {entry.thread === null ? (
                        <span className="chip">Unassigned</span>
                      ) : (
                        <span className="chip chip-reason">{entry.thread.title}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="stack" style={{ gap: 18 }}>
          <section className="panel">
            <div className="panel-head">
              <div className="stack" style={{ gap: 2 }}>
                <strong>需要你判斷</strong>
                <small className="muted">只在信心不足時詢問</small>
              </div>
              <span className="chip chip-paused">{inbox.length}</span>
            </div>
            <div className="panel-body stack" style={{ gap: 10 }}>
              {inbox.length === 0 ? (
                <p className="muted small">沒有待確認的項目。Nothing ambiguous right now.</p>
              ) : (
                <>
                  {inbox.slice(0, 3).map((entry) => (
                    <div className="row" key={entry.review.reviewId} style={{ gap: 9 }}>
                      <SiteMark host={entry.page?.host ?? '?'} />
                      <div className="grow stack" style={{ gap: 1, minWidth: 0 }}>
                        <span className="truncate small">
                          {entry.page?.title ?? 'Unknown page'}
                        </span>
                        <small className="muted">
                          {entry.review.candidates.length} 個可能的 Thread
                        </small>
                      </div>
                      <button className="btn-text" onClick={() => onGoto('inbox')}>
                        處理
                      </button>
                    </div>
                  ))}
                  <button className="btn btn-ghost" onClick={() => onGoto('inbox')}>
                    查看 Activity Inbox →
                  </button>
                </>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div className="stack" style={{ gap: 2 }}>
                <strong>開著，不代表在使用</strong>
                <small className="muted">Open is not the same as in use</small>
              </div>
            </div>
            <div className="panel-body stack" style={{ gap: 8 }}>
              <p className="small muted">
                {ambient} 次造訪今天沒有達到有意義的門檻，因此沒有被計入任何 Thread。
              </p>
              <p className="small muted">
                {ambient} visits today stayed below the attention threshold and were counted toward
                nothing. Background tabs accrue no time at all.
              </p>
              {stats !== null && stats.droppedSignals > 0 ? (
                <p className="small" style={{ color: 'var(--amber)' }}>
                  {stats.droppedSignals} 個低價值訊號因為佇列上限被丟棄（已如實記錄）。
                </p>
              ) : null}
            </div>
          </section>

          <section className="panel">
            <div className="panel-body stack" style={{ gap: 8 }}>
              <span className="eyebrow">Agent ready</span>
              <strong>把目前的 Thread 交給 agent</strong>
              <p className="small muted">產生含來源與省略說明的 Context Pack，全部在本機組裝。</p>
              <button className="btn btn-secondary" onClick={() => onGoto('agent')}>
                開啟 Agent Context →
              </button>
            </div>
          </section>
        </aside>
      </div>

      {inbox.length > 0 ? (
        <InboxPeek
          entries={inbox.slice(0, 1)}
          onResolve={(reviewId, threadId) =>
            void resolveClassification(uiContext(), reviewId, threadId)
          }
          onDismiss={(reviewId) => void dismissReview(uiContext(), reviewId)}
        />
      ) : null}
    </div>
  );
}

function Metric({
  value,
  label,
  accent,
}: {
  value: number;
  label: string;
  accent?: boolean;
}): ReactNode {
  return (
    <div className="stack" style={{ gap: 0 }}>
      <strong style={{ fontSize: 24, color: accent === true ? 'var(--amber)' : undefined }}>
        {value}
      </strong>
      <small className="muted">{label}</small>
    </div>
  );
}

/** A single inbox item inline, so the most common correction takes one click. */
function InboxPeek({
  entries,
  onResolve,
  onDismiss,
}: {
  entries: Awaited<ReturnType<typeof openInbox>>;
  onResolve: (reviewId: string, threadId: string | null) => void;
  onDismiss: (reviewId: string) => void;
}): ReactNode {
  const entry = entries[0];
  if (entry === undefined) return null;

  return (
    <section className="panel">
      <div className="panel-head">
        <div className="stack" style={{ gap: 2 }}>
          <strong>快速判斷 · One decision</strong>
          <small className="muted">{entry.page?.title ?? 'Unknown page'}</small>
        </div>
        <StatusChip status="paused" />
      </div>
      <div className="panel-body stack" style={{ gap: 12 }}>
        <Rationale reasons={entry.review.rationale} />
        <div className="stack" style={{ gap: 6 }}>
          {entry.review.candidates.map((candidate) => (
            <button
              key={candidate.threadId}
              className="btn btn-secondary"
              style={{ justifyContent: 'space-between' }}
              onClick={() => onResolve(entry.review.reviewId, candidate.threadId)}
            >
              <span className="truncate">{candidate.title}</span>
              <span className="muted small">{Math.round(candidate.score * 100)}%</span>
            </button>
          ))}
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn btn-ghost"
              onClick={() => onResolve(entry.review.reviewId, null)}
            >
              不屬於任何 Thread
            </button>
            <button className="btn btn-ghost" onClick={() => onDismiss(entry.review.reviewId)}>
              稍後
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
