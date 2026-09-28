import { useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { DEFAULT_VISIT_POLICY } from '@jevtabs/core-domain';
import {
  acceptHighConfidence,
  dismissReview,
  resolveClassification,
} from '../../storage/repository.js';
import { formatDuration, openInbox, relativeTime, uiContext } from '../data.js';
import { Dot, Empty, Rationale, SiteMark } from '../components.jsx';

/**
 * The Activity Inbox.
 *
 * The design constraint is that a correction must cost about a second. Anything
 * that makes it cost ten seconds means people stop correcting, the training
 * signal dries up, and the classifier never improves — so the whole screen is
 * arranged around a single keystroke-sized decision, with the reasoning next to
 * it rather than behind a disclosure.
 */
export function Inbox({ onOpenThread }: { onOpenThread: (id: string) => void }): ReactNode {
  const entries = useLiveQuery(() => openInbox(), [], []);
  const [busy, setBusy] = useState(false);

  async function acceptAll(): Promise<void> {
    setBusy(true);
    try {
      await acceptHighConfidence(uiContext(), DEFAULT_VISIT_POLICY.autoAssignConfidence - 0.1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <header
        className="row"
        style={{ justifyContent: 'space-between', gap: 20, alignItems: 'flex-end' }}
      >
        <div className="stack" style={{ gap: 6 }}>
          <p className="eyebrow">Activity inbox</p>
          <h1>只處理真正模糊的地方</h1>
          <p className="muted">
            高信心的活動已自動歸類。這裡只留下分類器沒有把握的部分。
            <br />
            Confident assignments were filed quietly. What is left is what the classifier was
            genuinely unsure about.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          disabled={busy || entries.length === 0}
          onClick={() => void acceptAll()}
        >
          接受高信心建議
        </button>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)',
          gap: 18,
        }}
      >
        <div className="stack" style={{ gap: 14 }}>
          {entries.length === 0 ? (
            <section className="panel">
              <Empty
                title="收件匣是空的"
                hint="Nothing ambiguous. Assignments the classifier was confident about were filed without asking."
              />
            </section>
          ) : (
            entries.map((entry) => (
              <article className="panel" key={entry.review.reviewId}>
                <div className="panel-head">
                  <div className="row" style={{ gap: 10, minWidth: 0 }}>
                    <SiteMark host={entry.page?.host ?? '?'} />
                    <div className="stack" style={{ gap: 1, minWidth: 0 }}>
                      <strong className="truncate">{entry.page?.title ?? 'Unknown page'}</strong>
                      <small className="muted truncate">
                        {entry.page?.host ?? ''} · {relativeTime(entry.review.createdAt)}
                        {entry.visit === null
                          ? ''
                          : ` · ${formatDuration(entry.visit.foregroundMs)}`}
                      </small>
                    </div>
                  </div>
                  <span className="chip chip-paused">
                    {Math.round(entry.review.confidence * 100)}%
                  </span>
                </div>

                <div className="panel-body stack" style={{ gap: 12 }}>
                  <Rationale reasons={entry.review.rationale} />

                  <div className="stack" style={{ gap: 6 }}>
                    {entry.review.candidates.map((candidate) => (
                      <button
                        key={candidate.threadId}
                        className="btn btn-secondary"
                        style={{ justifyContent: 'space-between', padding: '10px 12px' }}
                        onClick={() =>
                          void resolveClassification(
                            uiContext(),
                            entry.review.reviewId,
                            candidate.threadId,
                          )
                        }
                      >
                        <span className="row" style={{ gap: 9, minWidth: 0 }}>
                          <Dot accent="blue" />
                          <span
                            className="stack"
                            style={{ gap: 0, minWidth: 0, textAlign: 'left' }}
                          >
                            <strong className="truncate">{candidate.title}</strong>
                            <small className="muted truncate">{candidate.summary}</small>
                          </span>
                        </span>
                        <span className="muted small">{Math.round(candidate.score * 100)}%</span>
                      </button>
                    ))}
                  </div>

                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-ghost"
                      onClick={() =>
                        void resolveClassification(uiContext(), entry.review.reviewId, null)
                      }
                    >
                      忽略這次造訪 · Not work
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => void dismissReview(uiContext(), entry.review.reviewId)}
                    >
                      稍後 · Later
                    </button>
                    {entry.review.suggestedThreadId === null ? null : (
                      <button
                        className="btn-text"
                        onClick={() => onOpenThread(entry.review.suggestedThreadId as string)}
                      >
                        查看建議的 Thread →
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))
          )}
        </div>

        <aside className="panel" style={{ alignSelf: 'flex-start' }}>
          <div className="panel-head">
            <div className="stack" style={{ gap: 2 }}>
              <span className="eyebrow">Why we asked</span>
              <strong>URL 相似不等於同一件事</strong>
            </div>
          </div>
          <div className="panel-body stack" style={{ gap: 12 }}>
            <p className="small muted">
              判斷綜合了導覽來源、頁面語義、停留時間與既有 Thread。系統不會因為網址相似就自行合併。
            </p>
            <p className="small muted">
              The decision combines navigation ancestry, title semantics, dwell time, and the
              Threads that already exist. Similar URLs are never enough on their own.
            </p>
            <div
              className="stack"
              style={{ gap: 6, paddingTop: 6, borderTop: '1px solid var(--line)' }}
            >
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="small muted">Navigation ancestry</span>
                <strong className="small">25%</strong>
              </div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="small muted">Lexical similarity</span>
                <strong className="small">40%</strong>
              </div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="small muted">Recency</span>
                <strong className="small">20%</strong>
              </div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="small muted">Prior confirmations</span>
                <strong className="small">15%</strong>
              </div>
            </div>
            <p
              className="small"
              style={{
                background: 'var(--indigo-soft)',
                padding: 10,
                borderRadius: 'var(--radius)',
              }}
            >
              <strong>你的判斷留在本機。</strong>
              <br />
              Your corrections stay on this machine. They are never used to train a shared model.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
