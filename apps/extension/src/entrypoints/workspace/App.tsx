import { useEffect, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { quickStats, relativeTime, threadOverviews } from '../../ui/data.js';
import { Dot } from '../../ui/components.jsx';
import { Today } from '../../ui/views/Today.jsx';
import { Inbox } from '../../ui/views/Inbox.jsx';
import { Threads } from '../../ui/views/Threads.jsx';
import { ThreadDetail } from '../../ui/views/ThreadDetail.jsx';
import { AgentContext } from '../../ui/views/AgentContext.jsx';
import { Settings } from '../../ui/views/Settings.jsx';

/**
 * The workspace shell.
 *
 * Routing is a hash fragment rather than a router library: an extension page is
 * a single document with five destinations, and the fragment survives a reload
 * and a browser restart, which is all the persistence this needs.
 */

type View = 'today' | 'inbox' | 'threads' | 'thread' | 'agent' | 'settings';

interface Route {
  readonly view: View;
  readonly threadId?: string;
}

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [view, id] = raw.split('/');
  if (view === 'thread' && id !== undefined) return { view: 'thread', threadId: id };
  if (view === 'agent' && id !== undefined) return { view: 'agent', threadId: id };
  if (
    view === 'inbox' ||
    view === 'threads' ||
    view === 'agent' ||
    view === 'settings' ||
    view === 'today'
  ) {
    return { view };
  }
  return { view: 'today' };
}

export function App(): ReactNode {
  const [route, setRoute] = useState<Route>(parseHash);

  useEffect(() => {
    const onChange = (): void => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  function go(view: View, threadId?: string): void {
    window.location.hash = threadId === undefined ? `/${view}` : `/${view}/${threadId}`;
  }

  const stats = useLiveQuery(() => quickStats(), [], null);
  const active = useLiveQuery(() => threadOverviews(['active']), [], []);
  const dormant = useLiveQuery(() => threadOverviews(['dormant', 'paused']), [], []);

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside
        style={{
          width: 252,
          flex: 'none',
          borderRight: '1px solid var(--line)',
          background: 'var(--surface)',
          padding: '18px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          position: 'sticky',
          top: 0,
          height: '100vh',
          overflowY: 'auto',
        }}
      >
        <div className="row" style={{ gap: 10 }}>
          <span
            aria-hidden="true"
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: 'var(--indigo)',
              display: 'grid',
              placeItems: 'center',
              color: '#fff',
              fontWeight: 800,
              fontSize: 13,
            }}
          >
            J
          </span>
          <div className="stack" style={{ gap: 0 }}>
            <strong>JevTabs</strong>
            <small className="muted">Browser intent workspace</small>
          </div>
        </div>

        <nav className="stack" style={{ gap: 2 }}>
          <NavItem
            label="今日活動 · Today"
            active={route.view === 'today'}
            onClick={() => go('today')}
            badge={stats?.visitsToday}
          />
          <NavItem
            label="待確認 · Inbox"
            active={route.view === 'inbox'}
            onClick={() => go('inbox')}
            badge={stats?.openReviews}
            accent
          />
          <NavItem
            label="Research Threads"
            active={route.view === 'threads' || route.view === 'thread'}
            onClick={() => go('threads')}
          />
          <NavItem
            label="Agent Context"
            active={route.view === 'agent'}
            onClick={() => go('agent')}
          />
          <NavItem
            label="Settings"
            active={route.view === 'settings'}
            onClick={() => go('settings')}
          />
        </nav>

        <ThreadGroup title="Active threads" items={active} onOpen={(id) => go('thread', id)} />
        {dormant.length > 0 ? (
          <ThreadGroup title="Dormant" items={dormant} onOpen={(id) => go('thread', id)} />
        ) : null}

        <div className="stack" style={{ gap: 4, marginTop: 'auto' }}>
          <span className="chip chip-active">Local-first</span>
          <small className="muted">
            所有資料都在這台機器上。No account, no server, no network call.
          </small>
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0, padding: '26px 30px 60px' }}>
        {route.view === 'today' ? (
          <Today onOpenThread={(id) => go('thread', id)} onGoto={(view) => go(view as View)} />
        ) : null}
        {route.view === 'inbox' ? <Inbox onOpenThread={(id) => go('thread', id)} /> : null}
        {route.view === 'threads' ? <Threads onOpenThread={(id) => go('thread', id)} /> : null}
        {route.view === 'thread' && route.threadId !== undefined ? (
          <ThreadDetail
            threadId={route.threadId}
            onBack={() => go('threads')}
            onHandoff={(id) => go('agent', id)}
          />
        ) : null}
        {route.view === 'agent' ? <AgentContext initialThreadId={route.threadId} /> : null}
        {route.view === 'settings' ? <Settings /> : null}
      </main>
    </div>
  );
}

function NavItem({
  label,
  active,
  onClick,
  badge,
  accent,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
  accent?: boolean;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className="row"
      style={{
        gap: 8,
        width: '100%',
        padding: '8px 10px',
        border: 0,
        borderRadius: 'var(--radius)',
        background: active ? 'var(--indigo-soft)' : 'transparent',
        color: active ? 'var(--indigo)' : 'var(--ink-soft)',
        fontWeight: active ? 600 : 500,
        textAlign: 'left',
      }}
    >
      <span className="grow truncate">{label}</span>
      {badge !== undefined && badge > 0 ? (
        <b className="small" style={{ color: accent === true ? 'var(--amber)' : 'var(--muted)' }}>
          {badge}
        </b>
      ) : null}
    </button>
  );
}

function ThreadGroup({
  title,
  items,
  onOpen,
}: {
  title: string;
  items: Awaited<ReturnType<typeof threadOverviews>>;
  onOpen: (id: string) => void;
}): ReactNode {
  if (items.length === 0) return null;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <p className="eyebrow">{title}</p>
      {items.slice(0, 6).map((overview) => (
        <button
          key={overview.thread.threadId}
          type="button"
          className="row"
          onClick={() => onOpen(overview.thread.threadId)}
          style={{
            gap: 9,
            width: '100%',
            padding: '6px 10px',
            border: 0,
            borderRadius: 'var(--radius)',
            background: 'transparent',
            textAlign: 'left',
          }}
        >
          <Dot accent={overview.thread.accent} />
          <span className="stack grow" style={{ gap: 0, minWidth: 0 }}>
            <span className="truncate small">{overview.thread.title}</span>
            <small className="muted truncate">
              {overview.sourceCount} sources · {relativeTime(overview.thread.lastActivityAt)}
            </small>
          </span>
        </button>
      ))}
    </div>
  );
}
