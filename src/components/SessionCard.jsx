import StatusChip from "./StatusChip";
import { formatDate } from "../lib/session";

export default function SessionCard({
  session,
  onOpen,
  openLabel = "Open",
  onDownload,
  onDelete,
  onAnalytics,
  onDuplicate,
}) {
  return (
    <div className="adb-history-card">
      <div className="adb-history-main">
        <div className="adb-history-head">
          <h3 className="adb-history-name">{session.sessionName}</h3>
          <StatusChip status={session.status} />
        </div>
        <p className="adb-history-meta">
          {formatDate(session.sessionDate)}
          {session.roomCode ? ` · ${session.roomCode}` : ""}
        </p>
        <div className="adb-history-stats">
          <span>
            <strong>{session.participantCount}</strong> participants
          </span>
          <span>
            <strong>{session.questionCount}</strong> questions
          </span>
          <span>
            <strong>{session.avgScore}%</strong> avg score
          </span>
        </div>
      </div>
      <div className="adb-history-actions">
        {onOpen && (
          <button type="button" className="btn btn-primary btn-sm" onClick={onOpen}>
            {openLabel}
          </button>
        )}
        {onAnalytics && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onAnalytics}
          >
            View Analytics
          </button>
        )}
        {onDownload && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onDownload}
          >
            Download CSV
          </button>
        )}
        {onDuplicate && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onDuplicate}
          >
            Duplicate Session
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={onDelete}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
