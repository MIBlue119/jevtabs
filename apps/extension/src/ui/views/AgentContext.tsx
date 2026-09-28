import { useEffect, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  createIdGenerator,
  systemClock,
  type ContextDetail,
  type ContextPack,
  type ContextRequest,
} from '@jevtabs/core-domain';
import { createContextBroker, renderContextPackMarkdown } from '@jevtabs/context-broker';
import { db } from '../../storage/db.js';
import { createBrokerReadModel } from '../../storage/read-model.js';
import { threadOverviews } from '../data.js';
import { Dot, Empty } from '../components.jsx';

/**
 * Agent Context.
 *
 * Everything on this screen happens locally: the pack is assembled from the
 * same deterministic broker the future MCP server will call, and handed over by
 * copy or download. There is no transport and no credential, which is why this
 * is usable in Phase 1 without opening any of the questions an agent channel
 * would raise.
 *
 * The preview shows omissions as prominently as inclusions. An agent that
 * cannot tell "there is nothing" from "you were not shown it" will confidently
 * fill the gap.
 */

const DETAILS: { id: ContextDetail; label: string; hint: string }[] = [
  { id: 'brief', label: 'Brief', hint: 'Intent and confirmed findings only' },
  { id: 'evidence', label: 'Evidence', hint: 'Plus sources and open questions' },
  { id: 'full_trace', label: 'Full trace', hint: 'Plus the attention timeline' },
];

export function AgentContext({ initialThreadId }: { initialThreadId?: string }): ReactNode {
  const overviews = useLiveQuery(() => threadOverviews(), [], []);
  const [selected, setSelected] = useState<string[]>(
    initialThreadId === undefined ? [] : [initialThreadId],
  );
  const [task, setTask] = useState('');
  const [detail, setDetail] = useState<ContextDetail>('evidence');
  const [budget, setBudget] = useState(6000);
  const [include, setInclude] = useState({
    findings: true,
    sourceExcerpts: true,
    openQuestions: true,
    rawActivity: false,
  });
  const [pack, setPack] = useState<ContextPack | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (selected.length === 0 && overviews.length > 0 && initialThreadId === undefined) {
      const first = overviews[0];
      if (first !== undefined) setSelected([first.thread.threadId]);
    }
  }, [overviews, selected.length, initialThreadId]);

  useEffect(() => {
    if (selected.length === 0) {
      setPack(null);
      return;
    }
    const request: ContextRequest = {
      task: task.trim() === '' ? 'Continue this research.' : task.trim(),
      threadIds: selected.slice(0, 8),
      tokenBudget: budget,
      detail,
      include,
    };
    const broker = createContextBroker({
      store: createBrokerReadModel(db()),
      clock: systemClock,
      ids: createIdGenerator(systemClock),
    });
    let live = true;
    void broker.build(request).then((next) => {
      if (live) setPack(next);
    });
    return () => {
      live = false;
    };
  }, [selected, task, detail, budget, include]);

  const markdown = pack === null ? '' : renderContextPackMarkdown(pack);

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function download(): void {
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `jevtabs-context-${pack?.packId.slice(0, 8) ?? 'pack'}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <header className="stack" style={{ gap: 6 }}>
        <p className="eyebrow">Agent context</p>
        <h1>給 agent 任務需要的脈絡，不是整份瀏覽歷史</h1>
        <p className="muted">
          Context Broker 依任務、來源與 token budget 組裝可追溯的 Context Pack，全部在本機完成。
          <br />
          Assembled locally, cited, token-bounded, and explicit about what it left out.
        </p>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.6fr) minmax(300px, 1fr)',
          gap: 18,
        }}
      >
        <section className="panel">
          <div className="panel-body stack" style={{ gap: 18 }}>
            <div className="stack" style={{ gap: 6 }}>
              <label className="eyebrow" htmlFor="agent-task">
                1 · Agent 要完成什麼任務？
              </label>
              <textarea
                id="agent-task"
                className="field"
                value={task}
                placeholder="例：在 Chrome extension 中實作跨天 sessionization"
                onChange={(event) => setTask(event.target.value)}
              />
            </div>

            <div className="stack" style={{ gap: 6 }}>
              <span className="eyebrow">2 · 使用哪些 Thread？</span>
              {overviews.length === 0 ? (
                <Empty title="還沒有 Thread 可以交給 agent" />
              ) : (
                <div className="stack" style={{ gap: 4 }}>
                  {overviews.slice(0, 12).map((overview) => {
                    const active = selected.includes(overview.thread.threadId);
                    return (
                      <button
                        key={overview.thread.threadId}
                        className={`btn ${active ? 'btn-secondary' : 'btn-ghost'}`}
                        style={{ justifyContent: 'space-between' }}
                        onClick={() =>
                          setSelected((current) =>
                            active
                              ? current.filter((id) => id !== overview.thread.threadId)
                              : [...current, overview.thread.threadId].slice(0, 8),
                          )
                        }
                      >
                        <span className="row" style={{ gap: 8, minWidth: 0 }}>
                          <Dot accent={overview.thread.accent} />
                          <span className="truncate">{overview.thread.title}</span>
                        </span>
                        <span className="muted small">
                          {overview.sourceCount} sources {active ? '✓' : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="stack" style={{ gap: 8 }}>
              <span className="eyebrow">3 · Context depth</span>
              <div className="row" style={{ gap: 6 }}>
                {DETAILS.map((entry) => (
                  <button
                    key={entry.id}
                    className={`btn btn-sm ${detail === entry.id ? 'btn-primary' : 'btn-ghost'}`}
                    title={entry.hint}
                    onClick={() => setDetail(entry.id)}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              <label className="row small muted" style={{ gap: 10 }}>
                Token budget
                <input
                  type="range"
                  min={1000}
                  max={30000}
                  step={500}
                  value={budget}
                  onChange={(event) => setBudget(Number(event.target.value))}
                  style={{ flex: 1 }}
                />
                <strong style={{ color: 'var(--ink)', minWidth: 60, textAlign: 'right' }}>
                  {budget.toLocaleString()}
                </strong>
              </label>
              <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
                {(
                  [
                    ['findings', 'Key findings'],
                    ['sourceExcerpts', 'Source excerpts'],
                    ['openQuestions', 'Open questions'],
                    ['rawActivity', 'Raw activity'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="row small" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={include[key]}
                      onChange={(event) =>
                        setInclude((current) => ({ ...current, [key]: event.target.checked }))
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </section>

        <aside className="stack" style={{ gap: 18 }}>
          <section className="panel">
            <div className="panel-head">
              <div className="stack" style={{ gap: 2 }}>
                <span className="eyebrow">Context pack preview</span>
                <strong>
                  {pack === null ? '—' : `${pack.estimatedTokens.toLocaleString()} tokens`}
                </strong>
              </div>
            </div>
            <div className="panel-body stack" style={{ gap: 12 }}>
              {pack === null ? (
                <p className="small muted">選一個 Thread 以組裝 Context Pack。</p>
              ) : (
                <>
                  <div className="stack" style={{ gap: 4 }}>
                    {Object.entries(
                      pack.items.reduce<Record<string, number>>((counts, item) => {
                        counts[item.kind] = (counts[item.kind] ?? 0) + 1;
                        return counts;
                      }, {}),
                    ).map(([kind, count]) => (
                      <div className="row" key={kind} style={{ justifyContent: 'space-between' }}>
                        <span className="small muted">{kind}</span>
                        <strong className="small">{count}</strong>
                      </div>
                    ))}
                  </div>

                  <div
                    className="stack"
                    style={{ gap: 4, paddingTop: 10, borderTop: '1px solid var(--line)' }}
                  >
                    <span className="eyebrow">What is not included</span>
                    {pack.omissions.length === 0 ? (
                      <span className="small muted">Nothing was withheld.</span>
                    ) : (
                      pack.omissions.map((omission) => (
                        <div
                          className="row"
                          key={omission.reason}
                          style={{ justifyContent: 'space-between' }}
                        >
                          <span className="small muted">{omission.reason.replace(/_/g, ' ')}</span>
                          <strong className="small">{omission.count}</strong>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn btn-primary grow" onClick={() => void copy()}>
                      {copied ? '已複製 ✓' : '複製 Markdown'}
                    </button>
                    <button className="btn btn-secondary" onClick={download}>
                      下載
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <span className="eyebrow">Permissions</span>
            </div>
            <div className="panel-body stack" style={{ gap: 6 }}>
              {[
                ['讀取 Thread 摘要', true],
                ['讀取來源與節錄', true],
                ['提出 proposed finding', true],
                ['修改已確認的內容', false],
                ['刪除任何資料', false],
              ].map(([label, allowed]) => (
                <div
                  className="row"
                  key={String(label)}
                  style={{ justifyContent: 'space-between' }}
                >
                  <span className="small">{label}</span>
                  <span className={`chip ${allowed === true ? 'chip-active' : ''}`}>
                    {allowed === true ? 'Allowed' : 'Blocked'}
                  </span>
                </div>
              ))}
              <p className="small muted">
                Agent 的所有寫入都會先進入 Activity Inbox。An agent can never confirm its own
                proposal.
              </p>
            </div>
          </section>
        </aside>
      </div>

      {pack === null ? null : (
        <section className="panel">
          <div className="panel-head">
            <span className="eyebrow">Markdown</span>
            <span className="muted small">pack {pack.packId.slice(0, 8)}</span>
          </div>
          <pre
            className="panel-body small"
            style={{
              fontFamily: 'var(--mono)',
              whiteSpace: 'pre-wrap',
              maxHeight: 360,
              overflow: 'auto',
              margin: 0,
              background: 'var(--surface-sunken)',
              borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
            }}
          >
            {markdown}
          </pre>
        </section>
      )}
    </div>
  );
}
