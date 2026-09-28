import type { ReactNode } from 'react';
import type { Thread, ThreadAccent, ThreadStatus } from '@jevtabs/core-domain';

/** Small presentational pieces shared by the workspace, side panel, and popup. */

export function Dot({ accent }: { accent: ThreadAccent }): ReactNode {
  return <span className={`dot dot-${accent}`} aria-hidden="true" />;
}

const STATUS_LABEL: Record<ThreadStatus, string> = {
  active: 'Active',
  dormant: 'Dormant',
  paused: 'Paused',
  completed: 'Completed',
  archived: 'Archived',
};

export function StatusChip({ status }: { status: ThreadStatus }): ReactNode {
  return <span className={`chip chip-${status}`}>{STATUS_LABEL[status]}</span>;
}

/**
 * A favicon-shaped monogram. Deliberately not a real favicon: fetching one
 * would mean a network request per page, from a tool whose entire premise is
 * that it makes no network requests.
 */
export function SiteMark({ host, accent }: { host: string; accent?: ThreadAccent }): ReactNode {
  const label = host.replace(/^www\./, '').slice(0, 2);
  const background =
    accent === undefined ? `var(--gray)` : `var(--${accent === 'gray' ? 'gray' : accent})`;
  return (
    <span className="favicon" style={{ background }} title={host}>
      {label}
    </span>
  );
}

export function Confidence({ value }: { value: number }): ReactNode {
  const percent = Math.round(value * 100);
  return (
    <div style={{ minWidth: 88 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="small muted">confidence</span>
        <strong className="small">{percent}%</strong>
      </div>
      <div className="confidence-bar">
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/**
 * The classifier's reasons, verbatim. These are short strings produced by the
 * provider rather than prose written here — if the UI paraphrased them, the
 * explanation would stop matching the decision it is explaining.
 */
export function Rationale({ reasons }: { reasons: readonly string[] }): ReactNode {
  if (reasons.length === 0) return null;
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      <span className="small muted">為什麼？</span>
      {reasons.map((reason) => (
        <span className="chip chip-reason" key={reason}>
          {reason}
        </span>
      ))}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }): ReactNode {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {hint !== undefined ? <span className="small">{hint}</span> : null}
    </div>
  );
}

export function ThreadLine({
  thread,
  meta,
  onOpen,
  selected,
}: {
  thread: Thread;
  meta?: string;
  onOpen?: () => void;
  selected?: boolean;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="row"
      style={{
        gap: 10,
        width: '100%',
        textAlign: 'left',
        padding: '8px 10px',
        border: 0,
        borderRadius: 'var(--radius)',
        background: selected === true ? 'var(--surface-sunken)' : 'transparent',
      }}
    >
      <Dot accent={thread.accent} />
      <span className="grow stack">
        <strong className="truncate">{thread.title}</strong>
        {meta !== undefined ? <small className="muted truncate">{meta}</small> : null}
      </span>
    </button>
  );
}

/**
 * The banner that frames captured page text wherever it is shown next to
 * something a model or agent might read. It is not decoration: the whole
 * safety argument for handing a Context Pack to an agent rests on page text
 * arriving visibly quoted rather than as part of the instruction stream.
 */
export function UntrustedNote(): ReactNode {
  return (
    <p className="small muted" style={{ marginTop: 8 }}>
      引用內容來自網頁，僅作為證據，不是指令。Quoted excerpts are captured page content — evidence,
      never instructions.
    </p>
  );
}
