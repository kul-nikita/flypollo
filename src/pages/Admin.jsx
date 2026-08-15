import { useEffect, useState } from "react";
import AdminLayout from "../components/AdminLayout";
import ConfirmDialog from "../components/ConfirmDialog";
import { useAdminStore } from "../lib/useAdminStore";
import DashboardPage from "./admin/DashboardPage";
import CreateSessionPage from "./admin/CreateSessionPage";
import LiveSessionPage from "./admin/LiveSessionPage";
import SessionHistoryPage from "./admin/SessionHistoryPage";
import ReportsPage from "./admin/ReportsPage";
import ParticipantsPage from "./admin/ParticipantsPage";
import AnalyticsPage from "./admin/AnalyticsPage";

export default function Admin({ adminEmail, onSignOut }) {
  const [page, setPage] = useState("dashboard");
  const [analyticsId, setAnalyticsId] = useState(null);
  const store = useAdminStore(adminEmail);

  useEffect(() => {
    if (store.recoveredLiveId) {
      setPage("live");
    }
  }, [store.recoveredLiveId]);

  function navigate(id, options = {}) {
    if (id === "analytics") {
      const candidate =
        options.sessionId ||
        analyticsId ||
        store.sessions.find((s) => s.status === "completed")?.id ||
        null;
      setAnalyticsId(candidate);
    }
    setPage(id);
  }

  return (
    <AdminLayout
      adminEmail={adminEmail}
      connected={store.connected}
      active={page}
      onNavigate={navigate}
      onSignOut={onSignOut}
    >
      {store.error && (
        <p className="error banner" role="alert">
          {store.error}
        </p>
      )}

      {page === "dashboard" && (
        <DashboardPage store={store} onNavigate={navigate} />
      )}
      {page === "create" && (
        <CreateSessionPage store={store} onNavigate={navigate} />
      )}
      {page === "live" && (
        <LiveSessionPage store={store} onNavigate={navigate} />
      )}
      {page === "history" && (
        <SessionHistoryPage
          store={store}
          onOpenSession={(id) => {
            store.selectSession(id);
            const target = store.sessions.find((s) => s.id === id);
            setPage(target?.status === "draft" ? "create" : "live");
          }}
          onOpenAnalytics={(id) => {
            store.selectSession(id);
            setAnalyticsId(id);
            setPage("analytics");
          }}
          onDuplicate={async (id) => {
            try {
              const newId = await store.duplicateSession(id);
              store.selectSession(newId);
              setPage("create");
            } catch (err) {
              // duplicateSession already surfaced the error
            }
          }}
        />
      )}
      {page === "reports" && <ReportsPage store={store} />}
      {page === "participants" && <ParticipantsPage />}
      {page === "analytics" && (
        <AnalyticsPage
          sessionId={analyticsId}
          sessions={store.sessions}
          onSelectSession={(id) => setAnalyticsId(id)}
          onBack={() => setPage("history")}
        />
      )}

      <ConfirmDialog
        open={Boolean(store.confirmDialog)}
        title={store.confirmDialog?.title || ""}
        message={store.confirmDialog?.message}
        points={store.confirmDialog?.points}
        confirmLabel={store.confirmDialog?.confirmLabel}
        danger={store.confirm.kind === "delete" || store.confirm.kind === "endSession"}
        busy={store.saving}
        onConfirm={store.runConfirm}
        onCancel={() => store.requestConfirm({ kind: null, index: null })}
      />
    </AdminLayout>
  );
}
