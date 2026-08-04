import { useState } from "react";
import AdminLayout from "../components/AdminLayout";
import ConfirmDialog from "../components/ConfirmDialog";
import { useAdminStore } from "../lib/useAdminStore";
import DashboardPage from "./admin/DashboardPage";
import CreateSessionPage from "./admin/CreateSessionPage";
import LiveSessionPage from "./admin/LiveSessionPage";
import SessionHistoryPage from "./admin/SessionHistoryPage";
import ReportsPage from "./admin/ReportsPage";
import ParticipantsPage from "./admin/ParticipantsPage";

export default function Admin({ adminEmail, onSignOut }) {
  const [page, setPage] = useState("dashboard");
  const store = useAdminStore(adminEmail);

  return (
    <AdminLayout
      adminEmail={adminEmail}
      connected={store.connected}
      active={page}
      onNavigate={setPage}
      onSignOut={onSignOut}
    >
      {store.error && (
        <p className="error banner" role="alert">
          {store.error}
        </p>
      )}

      {page === "dashboard" && (
        <DashboardPage store={store} onNavigate={setPage} />
      )}
      {page === "create" && (
        <CreateSessionPage store={store} onNavigate={setPage} />
      )}
      {page === "live" && (
        <LiveSessionPage store={store} onNavigate={setPage} />
      )}
      {page === "history" && (
        <SessionHistoryPage
          store={store}
          onOpenSession={(id) => {
            store.selectSession(id);
            setPage("live");
          }}
        />
      )}
      {page === "reports" && <ReportsPage store={store} />}
      {page === "participants" && <ParticipantsPage />}

      <ConfirmDialog
        open={Boolean(store.confirmDialog)}
        title={store.confirmDialog?.title || ""}
        message={store.confirmDialog?.message}
        points={store.confirmDialog?.points}
        confirmLabel={store.confirmDialog?.confirmLabel}
        danger={store.confirm.kind === "delete" || store.confirm.kind === "endSession"}
        onConfirm={store.runConfirm}
        onCancel={() => store.requestConfirm({ kind: null, index: null })}
      />
    </AdminLayout>
  );
}
