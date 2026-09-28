import { useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { DAY_MS } from '@jevtabs/core-domain';
import {
  confirmThread,
  createCheckpoint,
  resolveClassification,
} from '../../storage/repository.js';
import {
  formatDuration,
  openInbox,
  recentTimeline,
  relativeTime,
  threadOverviews,
  uiContext,
} from '../../ui/data.js';
import { Confidence, Dot, Empty, Rationale, SiteMark } from '../../ui/components.jsx';

/**
 * The side panel.
 *
 * This is the surface someone has open *while* browsing, so it answers one
 * question — "what am I in the middle of?" — and offers only the actions that
 * make sense without leaving the page: confirm, correct, checkpoint. Anything
 * that needs deliberation belongs in the workspace.
 */
export function App(): ReactNode {
  const threads = useLiveQuery(() => threadOverviews(['active']), [], []);
  const timeline = useLiveQuery(() => recentTimeline(Date.now() - DAY_MS, 8), [], []);
  const inbox = useLiveQuery(() => openInbox(), [], []);
  const [saving, setSaving] = useState(false);

  const current = threads[0];
  const pending = inbox[0];

  async function checkpoint(): Promise<void> {
    if (current === undefined) return;
    const title = window.prompt('Checkpoint title', `Where I left ${current.thread.title}`);
    if (title === null || title.trim() === '') return;
    setSaving(true);
    try {
      await createCheckpoint(uiContext(), {
        threadId: current.thread.threadId,
        title: title.trim(),
        nextAction: '',
        openQuestions: [],
        pauseThread: true,
      });
    } finally {
      setSaving(false);
    }
  }

  function openWorkspace(hash = ''): void {
    void chrome.tabs.create({ url: chrome.runtime.getURL(`/workspace.html${hash}`) });
  }

  return (
    <div className="stack" style={{ gap: 14, padding: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>JevTabs</strong>
        <button className="btn-text" onClick={() => openWorkspace()}>
          Workspace →
        </button>
      </div>

      <section className="panel">
        <div className="panel-head" style={{ padding: '12px 14px' }}>
          <span className="eyebrow">Current thread</span>
        </div>
        {current === undefined ? (
          <Empty title="還沒有推論" hint="Keep browsing — only foreground attention counts." />
        ) : (
          <div className="panel-body stack" style={{ gap: 12, padding: '14px' }}>
            <div className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
              <Dot accent={current.thread.accent} />
              <div className="stack grow" style={{ gap: 2, minWidth: 0 }}>
                <strong>{current.thread.title}</strong>
                <small className="muted">
                  {current.sourceCount} sources · {relativeTime(current.thread.lastActivityAt)}
                </small>
              </div>
            </div>
            {current.confidence === null ? null : <Confidence value={current.confidence} />}
            <div className="row" style={{ gap: 6 }}>
              {current.thread.confirmed ? null : (
                <button
                  className="btn btn-primary btn-sm grow"
                  onClick={() => void confirmThread(uiContext(), current.thread.threadId)}
                >
                  確認
                </button>
              )}
              <button
                className="btn btn-secondary btn-sm grow"
                disabled={saving}
                onClick={() => void checkpoint()}
              >
                Checkpoint
              </button>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => openWorkspace(`#/thread/${current.thread.threadId}`)}
            >
              查看完整 Thread →
            </button>
          </div>
        )}
      </section>

      {pending === undefined ? null : (
        <section className="panel">
          <div className="panel-head" style={{ padding: '12px 14px' }}>
            <div className="stack" style={{ gap: 2, minWidth: 0 }}>
              <span className="eyebrow">需要判斷 · {inbox.length}</span>
              <small className="muted truncate">{pending.page?.title ?? 'Unknown page'}</small>
            </div>
          </div>
          <div className="panel-body stack" style={{ gap: 10, padding: 14 }}>
            <Rationale reasons={pending.review.rationale.slice(0, 2)} />
            {pending.review.candidates.slice(0, 3).map((candidate) => (
              <button
                key={candidate.threadId}
                className="btn btn-secondary btn-sm"
                style={{ justifyContent: 'space-between' }}
                onClick={() =>
                  void resolveClassification(
                    uiContext(),
                    pending.review.reviewId,
                    candidate.threadId,
                  )
                }
              >
                <span className="truncate">{candidate.title}</span>
                <span className="muted">{Math.round(candidate.score * 100)}%</span>
              </button>
            ))}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => void resolveClassification(uiContext(), pending.review.reviewId, null)}
            >
              不屬於任何 Thread
            </button>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head" style={{ padding: '12px 14px' }}>
          <span className="eyebrow">Recent foreground</span>
        </div>
        <div className="panel-body stack" style={{ gap: 8, padding: 14 }}>
          {timeline.length === 0 ? (
            <p className="small muted">No meaningful visits yet today.</p>
          ) : (
            timeline.map((entry) => (
              <div className="row" key={entry.visit.visitId} style={{ gap: 9 }}>
                <SiteMark host={entry.page.host} accent={entry.thread?.accent} />
                <div className="stack grow" style={{ gap: 0, minWidth: 0 }}>
                  <span className="small truncate">{entry.page.title || entry.page.host}</span>
                  <small className="muted truncate">
                    {entry.page.host} · {formatDuration(entry.visit.foregroundMs)}
                  </small>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
