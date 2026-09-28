import { useEffect, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { systemClock } from '@jevtabs/core-domain';
import { db } from '../../storage/db.js';
import {
  eraseEverything,
  exportAll,
  exportMarkdown,
  inspectStorage,
} from '../../storage/export.js';
import { applyRetention, purgeDomain, saveSettings } from '../../storage/repository.js';
import { uiContext } from '../data.js';

/**
 * Settings.
 *
 * This screen is where the privacy contract stops being a document and becomes
 * something you can check. Hence the storage inspector: the claim "we only
 * keep these shapes" is worth very little if you cannot look.
 */
export function Settings(): ReactNode {
  const snapshot = useLiveQuery(() => inspectStorage(db(), systemClock), [], null);
  const [domain, setDomain] = useState('');
  const [signalsGranted, setSignalsGranted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    void chrome.permissions.contains({ origins: ['<all_urls>'] }).then(setSignalsGranted);
  }, []);

  if (snapshot === null) return <p className="muted">Loading…</p>;
  const { settings, tables, captureSessionId, droppedSignals } = snapshot;

  async function patch(next: Parameters<typeof saveSettings>[2]): Promise<void> {
    await saveSettings(db(), systemClock, next);
  }

  async function toggleSignals(enable: boolean): Promise<void> {
    if (enable) {
      const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
      setSignalsGranted(granted);
      if (!granted) return;
      await chrome.scripting.registerContentScripts([
        {
          id: 'jevtabs-signals',
          js: ['content-scripts/signals.js'],
          matches: ['<all_urls>'],
          runAt: 'document_idle',
        },
      ]);
    } else {
      await chrome.scripting.unregisterContentScripts({ ids: ['jevtabs-signals'] }).catch(() => {});
      await chrome.permissions.remove({ origins: ['<all_urls>'] });
      setSignalsGranted(false);
    }
  }

  async function addExclusion(): Promise<void> {
    const host = domain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .split('/')[0];
    if (host === undefined || host === '') return;
    await patch({ excludedDomains: [...new Set([...settings.excludedDomains, host])] });
    setBusy('purging');
    await purgeDomain(uiContext(), host);
    setBusy('');
    setDomain('');
  }

  function downloadFile(name: string, content: string, type: string): void {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="stack" style={{ gap: 18, maxWidth: 780 }}>
      <header className="stack" style={{ gap: 6 }}>
        <p className="eyebrow">Settings</p>
        <h1>你可以檢查每一件被記錄的事</h1>
        <p className="muted">
          Everything JevTabs holds is on this machine and listed below. Nothing is uploaded, and
          there is no account to delete.
        </p>
      </header>

      <section className="panel">
        <div className="panel-head">
          <strong>Capture</strong>
        </div>
        <div className="panel-body">
          <div className="switch-row">
            <div className="stack" style={{ gap: 2 }}>
              <strong className="small">記錄前景活動 · Record foreground activity</strong>
              <span className="small muted">關閉後不會記錄任何事件，已存在的資料保留不變。</span>
            </div>
            <input
              type="checkbox"
              checked={settings.trackingEnabled}
              onChange={(event) => void patch({ trackingEnabled: event.target.checked })}
            />
          </div>

          <div className="switch-row">
            <div className="stack" style={{ gap: 2 }}>
              <strong className="small">互動訊號 · Interaction signals</strong>
              <span className="small muted">
                需要 <code>&lt;all_urls&gt;</code> 權限，只回報「有捲動 / 有選取 /
                有複製」四個布林值， 不包含選取的文字、剪貼簿內容或座標。
                <br />
                Requires host access. Sends four booleans — that a scroll, selection, copy, or media
                playback happened. Never the text, the clipboard, or coordinates.
              </span>
            </div>
            <input
              type="checkbox"
              checked={signalsGranted === true}
              onChange={(event) => void toggleSignals(event.target.checked)}
            />
          </div>

          <div className="switch-row">
            <div className="stack" style={{ gap: 2 }}>
              <strong className="small">保留文件識別的查詢參數</strong>
              <span className="small muted">
                預設關閉，所有 query value 都會被丟棄。開啟後只保留 v、id、page 等識別文件的參數。
              </span>
            </div>
            <input
              type="checkbox"
              checked={settings.keepDocumentQueryParams}
              onChange={(event) => void patch({ keepDocumentQueryParams: event.target.checked })}
            />
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div className="stack" style={{ gap: 2 }}>
            <strong>Excluded domains</strong>
            <small className="muted">
              排除後會立即刪除該網域既有的所有紀錄。Adding one also erases what was already
              recorded.
            </small>
          </div>
        </div>
        <div className="panel-body stack" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="field grow"
              placeholder="example.com"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void addExclusion();
              }}
            />
            <button
              className="btn btn-secondary"
              disabled={busy !== ''}
              onClick={() => void addExclusion()}
            >
              {busy === 'purging' ? '刪除中…' : '排除'}
            </button>
          </div>
          {settings.excludedDomains.length === 0 ? (
            <p className="small muted">
              尚未排除任何網域。驗證、金融、健康、密碼管理與付款頁面本來就預設封鎖。
            </p>
          ) : (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {settings.excludedDomains.map((host) => (
                <button
                  key={host}
                  className="chip chip-reason"
                  title="Remove"
                  onClick={() =>
                    void patch({
                      excludedDomains: settings.excludedDomains.filter((entry) => entry !== host),
                    })
                  }
                >
                  {host} ✕
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <strong>Retention</strong>
        </div>
        <div className="panel-body stack" style={{ gap: 12 }}>
          <label className="row small" style={{ gap: 10 }}>
            原始事件保留天數 · raw events
            <input
              type="number"
              className="field"
              style={{ width: 90 }}
              min={1}
              max={365}
              value={settings.retention.rawEventDays}
              onChange={(event) =>
                void patch({
                  retention: { ...settings.retention, rawEventDays: Number(event.target.value) },
                })
              }
            />
            days
          </label>
          <p className="small muted">
            已確認的 Evidence、Findings 與 Checkpoints 會一直保留，直到你自己刪除。
            <br />
            Confirmed knowledge is kept until you delete it — retention only expires the raw tape
            and Visits that never became work.
          </p>
          <div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                void (async () => {
                  const result = await applyRetention(uiContext());
                  window.alert(
                    `Removed ${result.events} events and ${result.visits} unpromoted visits.`,
                  );
                })();
              }}
            >
              立即執行保留政策
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div className="stack" style={{ gap: 2 }}>
            <strong>What is stored</strong>
            <small className="muted">capture session {captureSessionId?.slice(0, 8) ?? '—'}</small>
          </div>
        </div>
        <div className="panel-body stack" style={{ gap: 10 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              gap: 8,
            }}
          >
            {tables.map((table) => (
              <div className="row" key={table.name} style={{ justifyContent: 'space-between' }}>
                <span className="small muted">{table.name}</span>
                <strong className="small">{table.rows.toLocaleString()}</strong>
              </div>
            ))}
          </div>
          {droppedSignals > 0 ? (
            <p className="small" style={{ color: 'var(--amber)' }}>
              {droppedSignals} 個低價值訊號因佇列上限被丟棄。Loss is recorded rather than hidden.
            </p>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <strong>Export</strong>
        </div>
        <div className="panel-body row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary"
            onClick={() => {
              void (async () => {
                const bundle = await exportAll(db(), systemClock);
                downloadFile(
                  'jevtabs-export.json',
                  JSON.stringify(bundle, null, 2),
                  'application/json',
                );
              })();
            }}
          >
            匯出 JSON
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              void (async () => {
                downloadFile(
                  'jevtabs-export.md',
                  await exportMarkdown(db(), systemClock),
                  'text/markdown',
                );
              })();
            }}
          >
            匯出 Markdown
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              if (
                !window.confirm(
                  'Delete every JevTabs record on this machine? This cannot be undone.',
                )
              ) {
                return;
              }
              void eraseEverything(db());
            }}
          >
            刪除所有資料
          </button>
        </div>
      </section>
    </div>
  );
}
