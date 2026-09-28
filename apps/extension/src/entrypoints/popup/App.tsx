import { useEffect, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { MINUTE_MS, systemClock, toTimestamp, tryNormalizeUrl } from '@jevtabs/core-domain';
import { db } from '../../storage/db.js';
import { loadSettings, purgeDomain, saveSettings } from '../../storage/repository.js';
import { quickStats, uiContext } from '../../ui/data.js';

/**
 * The popup.
 *
 * Four controls, all of them about the browser's current state: is JevTabs
 * recording, pause it, exclude this site, open the workspace. Deliberately
 * boring — a popup is something people open when they want one specific thing
 * to stop or start, not somewhere to browse their data.
 */
export function App(): ReactNode {
  const settings = useLiveQuery(() => loadSettings(db(), systemClock), [], null);
  const stats = useLiveQuery(() => quickStats(), [], null);
  const [host, setHost] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const normalized = tab?.url === undefined ? null : tryNormalizeUrl(tab.url);
      setHost(normalized?.host ?? null);
    })();
  }, []);

  if (settings === null) return <div style={{ padding: 16 }}>Loading…</div>;

  const pausedUntilMs = settings.pausedUntil === null ? 0 : Date.parse(settings.pausedUntil);
  const paused = pausedUntilMs > Date.now();
  const recording = settings.trackingEnabled && !paused;
  const excluded = host !== null && settings.excludedDomains.includes(host);

  async function pause(minutes: number): Promise<void> {
    await saveSettings(db(), systemClock, {
      pausedUntil: toTimestamp(Date.now() + minutes * MINUTE_MS),
    });
  }

  const exclude = async (): Promise<void> => {
    if (host === null) return;
    setBusy(true);
    try {
      await saveSettings(db(), systemClock, {
        excludedDomains: [...new Set([...settings.excludedDomains, host])],
      });
      // Excluding a domain also erases what was already recorded for it —
      // otherwise "stop watching this" would leave the watching behind.
      await purgeDomain(uiContext(), host);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ width: 288, padding: 14, gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>JevTabs</strong>
        <span className={`chip ${recording ? 'chip-active' : 'chip-paused'}`}>
          {recording ? 'Recording' : paused ? 'Paused' : 'Off'}
        </span>
      </div>

      <div className="row" style={{ gap: 16 }}>
        <Stat value={stats?.visitsToday ?? 0} label="visits today" />
        <Stat value={stats?.activeThreads ?? 0} label="threads" />
        <Stat value={stats?.openReviews ?? 0} label="to review" />
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <button
          className="btn btn-secondary"
          onClick={() =>
            void saveSettings(db(), systemClock, {
              trackingEnabled: !settings.trackingEnabled,
              pausedUntil: null,
            })
          }
        >
          {settings.trackingEnabled ? '停止記錄 · Stop recording' : '開始記錄 · Start recording'}
        </button>

        {settings.trackingEnabled ? (
          paused ? (
            <button
              className="btn btn-ghost"
              onClick={() => void saveSettings(db(), systemClock, { pausedUntil: null })}
            >
              恢復（已暫停至 {new Date(pausedUntilMs).toLocaleTimeString()}）
            </button>
          ) : (
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-ghost btn-sm grow" onClick={() => void pause(30)}>
                暫停 30m
              </button>
              <button className="btn btn-ghost btn-sm grow" onClick={() => void pause(120)}>
                2h
              </button>
              <button className="btn btn-ghost btn-sm grow" onClick={() => void pause(60 * 8)}>
                今天
              </button>
            </div>
          )
        ) : null}

        {host === null ? null : excluded ? (
          <p className="small muted">{host} 已排除，不會被記錄。</p>
        ) : (
          <button className="btn btn-ghost" disabled={busy} onClick={() => void exclude()}>
            {busy ? '刪除中…' : `排除 ${host}`}
          </button>
        )}
      </div>

      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary grow"
          onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('/workspace.html') })}
        >
          開啟 Workspace
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => {
            void (async () => {
              const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
              if (tab?.windowId !== undefined)
                await chrome.sidePanel.open({ windowId: tab.windowId });
              window.close();
            })();
          }}
        >
          側欄
        </button>
      </div>

      <p className="small muted">本機儲存，不上傳。Local storage only — no account, no server.</p>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }): ReactNode {
  return (
    <div className="stack" style={{ gap: 0 }}>
      <strong style={{ fontSize: 18 }}>{value}</strong>
      <small className="muted">{label}</small>
    </div>
  );
}
