import { useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  addFinding,
  createCheckpoint,
  deleteThread,
  setFindingState,
  updateThread,
} from '../../storage/repository.js';
import { formatDuration, relativeTime, threadDetail, uiContext } from '../data.js';
import { Empty, StatusChip, UntrustedNote } from '../components.jsx';

/**
 * Thread detail.
 *
 * The ordering is the argument: intent, then what was settled, then what is
 * still open, then the sources. A findings list that mixed human-confirmed
 * claims with agent proposals would quietly erase the distinction the whole
 * trust model rests on, so proposals are visually separate and inert until
 * someone accepts them.
 */
export function ThreadDetail({
  threadId,
  onBack,
  onHandoff,
}: {
  threadId: string;
  onBack: () => void;
  onHandoff: (threadId: string) => void;
}): ReactNode {
  const detail = useLiveQuery(() => threadDetail(threadId), [threadId], undefined);
  const [draftFinding, setDraftFinding] = useState('');
  const [editingIntent, setEditingIntent] = useState(false);
  const [intentDraft, setIntentDraft] = useState('');

  if (detail === undefined) return <p className="muted">Loading…</p>;
  if (detail === null) {
    return (
      <div className="panel">
        <Empty title="這個 Thread 已經不存在" hint="It may have been deleted." />
      </div>
    );
  }

  const { thread, evidence, findings, checkpoints, visits } = detail;
  const confirmed = findings.filter((finding) => finding.state === 'confirmed');
  const proposed = findings.filter((finding) => finding.state === 'proposed');
  const latestCheckpoint = checkpoints[0];
  const totalMs = visits.reduce((sum, entry) => sum + entry.visit.foregroundMs, 0);

  async function saveFinding(): Promise<void> {
    const text = draftFinding.trim();
    if (text === '') return;
    await addFinding(uiContext(), threadId, text);
    setDraftFinding('');
  }

  async function saveIntent(): Promise<void> {
    await updateThread(uiContext(), threadId, { intent: intentDraft.trim() });
    setEditingIntent(false);
  }

  async function checkpoint(): Promise<void> {
    const title = window.prompt('Checkpoint title', `Where I left ${thread.title}`);
    if (title === null || title.trim() === '') return;
    const nextAction = window.prompt('Next action (what future-you should do first)') ?? '';
    await createCheckpoint(uiContext(), {
      threadId,
      title: title.trim(),
      nextAction: nextAction.trim(),
      openQuestions: [],
      pauseThread: true,
    });
  }

  async function remove(): Promise<void> {
    if (!window.confirm(`Delete “${thread.title}”? Its sources and findings are removed too.`))
      return;
    await deleteThread(uiContext(), threadId);
    onBack();
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn-text" onClick={onBack}>
          ← Research Threads
        </button>
        <span className="muted small">/ {thread.title}</span>
      </div>

      <header
        className="row"
        style={{ justifyContent: 'space-between', gap: 20, alignItems: 'flex-start' }}
      >
        <div className="stack" style={{ gap: 8, minWidth: 0 }}>
          <div className="row" style={{ gap: 10 }}>
            <StatusChip status={thread.status} />
            {thread.confirmed ? null : <span className="chip">Unconfirmed</span>}
            <span className="chip chip-reason">
              {evidence.length} sources · {formatDuration(totalMs)}
            </span>
          </div>
          <h1>{thread.title}</h1>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => void checkpoint()}>
            建立 Checkpoint
          </button>
          <button
            className="btn btn-secondary"
            onClick={() =>
              void updateThread(uiContext(), threadId, {
                status: thread.status === 'paused' ? 'active' : 'paused',
              })
            }
          >
            {thread.status === 'paused' ? '恢復 Thread' : '暫停 Thread'}
          </button>
          <button className="btn btn-primary" onClick={() => onHandoff(threadId)}>
            提供給 Agent
          </button>
        </div>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.8fr) minmax(280px, 1fr)',
          gap: 18,
        }}
      >
        <div className="stack" style={{ gap: 18 }}>
          <section className="panel">
            <div className="panel-head">
              <span className="eyebrow">What I was trying to answer</span>
              {editingIntent ? null : (
                <button
                  className="btn-text"
                  onClick={() => {
                    setIntentDraft(thread.intent);
                    setEditingIntent(true);
                  }}
                >
                  編輯
                </button>
              )}
            </div>
            <div className="panel-body">
              {editingIntent ? (
                <div className="stack" style={{ gap: 8 }}>
                  <textarea
                    className="field"
                    value={intentDraft}
                    onChange={(event) => setIntentDraft(event.target.value)}
                    placeholder="這個 Thread 想回答什麼問題？"
                  />
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => void saveIntent()}>
                      儲存
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setEditingIntent(false)}
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : thread.intent === '' ? (
                <p className="muted">
                  尚未記錄意圖。JevTabs 不會替你編造 — 這一行由你決定。
                  <br />
                  No intent recorded. JevTabs will not invent one for you.
                </p>
              ) : (
                <h2 style={{ fontWeight: 600, lineHeight: 1.45 }}>{thread.intent}</h2>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <span className="eyebrow">Key findings</span>
              <span className="muted small">{confirmed.length} confirmed</span>
            </div>
            <div className="panel-body stack" style={{ gap: 14 }}>
              {confirmed.length === 0 && proposed.length === 0 ? (
                <p className="muted small">
                  還沒有結論。Add what you have settled, in your own words.
                </p>
              ) : null}

              {confirmed.map((finding, index) => (
                <div
                  className="row"
                  key={finding.findingId}
                  style={{ gap: 12, alignItems: 'flex-start' }}
                >
                  <strong className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {String(index + 1).padStart(2, '0')}
                  </strong>
                  <div className="stack grow" style={{ gap: 3 }}>
                    <strong>{finding.text}</strong>
                    {finding.detail === '' ? null : <p className="small muted">{finding.detail}</p>}
                    <small className="muted">
                      ✓ Human confirmed · {relativeTime(finding.updatedAt)}
                      {finding.sourceRefs.length > 0
                        ? ` · ${finding.sourceRefs.length} sources`
                        : ''}
                    </small>
                  </div>
                </div>
              ))}

              {proposed.length > 0 ? (
                <div
                  className="stack"
                  style={{
                    gap: 10,
                    padding: 12,
                    borderRadius: 'var(--radius)',
                    background: 'var(--amber-soft)',
                  }}
                >
                  <span className="eyebrow">Proposed · awaiting your decision</span>
                  {proposed.map((finding) => (
                    <div
                      className="row"
                      key={finding.findingId}
                      style={{ gap: 10, alignItems: 'flex-start' }}
                    >
                      <div className="stack grow" style={{ gap: 2 }}>
                        <strong>{finding.text}</strong>
                        <small className="muted">Proposed by {finding.author}</small>
                      </div>
                      <div className="row" style={{ gap: 6 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() =>
                            void setFindingState(uiContext(), finding.findingId, 'rejected')
                          }
                        >
                          ✕
                        </button>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() =>
                            void setFindingState(uiContext(), finding.findingId, 'confirmed')
                          }
                        >
                          ✓
                        </button>
                      </div>
                    </div>
                  ))}
                  <p className="small muted">
                    Agents may propose. Only you can confirm — that asymmetry is deliberate.
                  </p>
                </div>
              ) : null}

              <div className="row" style={{ gap: 8 }}>
                <input
                  className="field grow"
                  value={draftFinding}
                  placeholder="新增一個結論 · add what you concluded"
                  onChange={(event) => setDraftFinding(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void saveFinding();
                  }}
                />
                <button className="btn btn-secondary" onClick={() => void saveFinding()}>
                  新增
                </button>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <span className="eyebrow">Sources</span>
              <span className="muted small">{evidence.length}</span>
            </div>
            <div className="panel-body stack" style={{ gap: 10 }}>
              {evidence.length === 0 ? (
                <p className="muted small">還沒有來源。</p>
              ) : (
                evidence.map((row) => (
                  <div className="row" key={row.evidenceId} style={{ gap: 10 }}>
                    <span className="chip chip-reason">{row.role}</span>
                    <div className="stack grow" style={{ gap: 0, minWidth: 0 }}>
                      <a className="truncate" href={row.url} target="_blank" rel="noreferrer">
                        {row.title || row.url}
                      </a>
                      <small className="muted truncate">{row.url}</small>
                    </div>
                    <small className="muted">{relativeTime(row.capturedAt)}</small>
                  </div>
                ))
              )}
              <UntrustedNote />
            </div>
          </section>
        </div>

        <aside className="stack" style={{ gap: 18 }}>
          <section className="panel">
            <div className="panel-head">
              <div className="stack" style={{ gap: 2 }}>
                <strong>Checkpoints</strong>
                <small className="muted">Where you left off</small>
              </div>
            </div>
            <div className="panel-body stack" style={{ gap: 12 }}>
              {latestCheckpoint === undefined ? (
                <p className="small muted">
                  還沒有 checkpoint。建立一個，讓幾週後的你不用重新拼湊 context。
                </p>
              ) : (
                checkpoints.slice(0, 4).map((entry) => (
                  <div className="stack" key={entry.checkpointId} style={{ gap: 3 }}>
                    <strong className="small">{entry.title}</strong>
                    {entry.nextAction === '' ? null : (
                      <p className="small muted">→ {entry.nextAction}</p>
                    )}
                    <small className="muted">{relativeTime(entry.createdAt)}</small>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div className="stack" style={{ gap: 2 }}>
                <strong>Research path</strong>
                <small className="muted">How this unfolded</small>
              </div>
            </div>
            <div className="panel-body stack" style={{ gap: 10 }}>
              {visits.length === 0 ? (
                <p className="small muted">No recorded visits.</p>
              ) : (
                visits
                  .slice()
                  .reverse()
                  .slice(0, 8)
                  .map((entry) => (
                    <div className="stack" key={entry.visit.visitId} style={{ gap: 1 }}>
                      <span className="small truncate">{entry.page.title || entry.page.host}</span>
                      <small className="muted">
                        {entry.page.host} · {formatDuration(entry.visit.foregroundMs)} ·{' '}
                        {relativeTime(entry.visit.startedAt)}
                      </small>
                    </div>
                  ))
              )}
            </div>
          </section>

          <button className="btn btn-danger" onClick={() => void remove()}>
            刪除這個 Thread
          </button>
        </aside>
      </div>
    </div>
  );
}
