import { useEffect, useState } from "react";
import Logo from "./Logo";
import ConnectionPill from "./ConnectionPill";
import ConfirmDialog from "./ConfirmDialog";

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: "🏠" },
  { id: "create", label: "Create Session", icon: "➕" },
  { id: "live", label: "Live Session", icon: "📡" },
  { id: "history", label: "Session History", icon: "📚" },
  { id: "analytics", label: "Analytics", icon: "📈" },
  { id: "reports", label: "Reports", icon: "📊" },
  { id: "participants", label: "Participants", icon: "👥" },
];

export default function AdminLayout({
  adminEmail,
  connected,
  active,
  onNavigate,
  onSignOut,
  children,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [confirmSignout, setConfirmSignout] = useState(false);

  function navigate(id) {
    onNavigate(id);
    setSidebarOpen(false);
  }

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") setSidebarOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="adb">
      <aside className={`adb-sidebar ${sidebarOpen ? "adb-sidebar-open" : ""}`}>
        <div className="adb-brand">
          <Logo size={30} withText />
        </div>
        <div className="adb-sidebar-divider" aria-hidden="true" />
        <nav className="adb-nav" aria-label="Presenter console">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`adb-nav-item ${active === item.id ? "adb-nav-active" : ""}`}
              onClick={() => navigate(item.id)}
            >
              <span className="adb-nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="adb-sidebar-footer">
          <div className="adb-sidebar-user">
            <span className="adb-user-avatar" aria-hidden="true">
              {adminEmail.charAt(0).toUpperCase()}
            </span>
            <span className="adb-user-email" title={adminEmail}>
              {adminEmail}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm adb-signout"
            onClick={() => setConfirmSignout(true)}
          >
            Sign out
          </button>
        </div>
      </aside>

      {sidebarOpen && (
        <div
          className="adb-overlay"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="adb-main">
        <div className="adb-topbar">
          <button
            type="button"
            className="adb-hamburger"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label="Toggle navigation"
            aria-expanded={sidebarOpen}
          >
            <span aria-hidden="true">☰</span>
          </button>
          <span className="adb-topbar-title">Presenter Console</span>
          <span className="adb-topbar-spacer" />
          <ConnectionPill connected={connected} />
        </div>
        <div className="adb-content">{children}</div>
      </div>

      <ConfirmDialog
        open={confirmSignout}
        title="Sign out?"
        message={`Signed in as ${adminEmail}. You'll be able to sign back in with the same email.`}
        confirmLabel="Sign out"
        onConfirm={() => {
          setConfirmSignout(false);
          onSignOut();
        }}
        onCancel={() => setConfirmSignout(false)}
      />
    </div>
  );
}
