import { useState } from "react";
import SessionCard from "../../components/SessionCard";
import ConfirmDialog from "../../components/ConfirmDialog";
import { useToast } from "../../components/Toasts";

export default function SessionHistoryPage({ store, onOpenSession }) {
  const { sessions, loading, downloadSessionCsv, removeSession } = store;
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await removeSession(deleting);
      showToast("Session deleted.", "success");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  if (loading) {
    return (
      <div className="adb-page">
        <div className="skeleton skeleton-block" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line" />
      </div>
    );
  }

  return (
    <div className="adb-page">
      <header className="adb-page-head">
        <h1 className="adb-page-title">Session History</h1>
        <p className="adb-page-sub">
          {sessions.length} session{sessions.length === 1 ? "" : "s"} on
          record, newest first.
        </p>
      </header>

      {sessions.length === 0 ? (
        <div className="adb-card adb-empty">
          <p>No sessions yet. Create and publish one to see it here.</p>
        </div>
      ) : (
        <div className="adb-history-list">
          {sessions.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              onOpen={() => onOpenSession(s.id)}
              onDownload={() => downloadSessionCsv(s)}
              onDelete={() => setDeleting(s.id)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete session?"
        message="This permanently deletes the session and its stored questions. Participant answers and reports for it will be lost."
        confirmLabel={busy ? "Deleting…" : "Delete session"}
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
