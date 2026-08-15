import { useEffect, useState } from "react";
import Logo from "./Logo";
import ConnectionPill from "./ConnectionPill";
import ConfirmDialog from "./ConfirmDialog";

const ICON_SIZE = 18;

function Icon({ name, size = ICON_SIZE }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
  };
  switch (name) {
    case "dashboard":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "create":
      return (
        <svg {...common}>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      );
    case "live":
      return (
        <svg {...common}>
          <path d="M4.9 8.6a10 10 0 0 1 14.2 0" />
          <path d="M7.8 11.8a6 6 0 0 1 8.4 0" />
          <path d="M10.7 15a2.4 2.4 0 0 1 2.6 0" />
          <circle cx="12" cy="18.5" r="1.1" />
        </svg>
      );
    case "history":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "analytics":
      return (
        <svg {...common}>
          <path d="M4 20V10" />
          <path d="M10 20V4" />
          <path d="M16 20v-7" />
          <path d="M22 20H2" />
        </svg>
      );
    case "reports":
      return (
        <svg {...common}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
          <path d="M9 13h6" />
          <path d="M9 17h6" />
        </svg>
      );
    case "menu":
      return (
        <svg {...common}>
          <path d="M4 6h16" />
          <path d="M4 12h16" />
          <path d="M4 18h16" />
        </svg>
      );
    case "participants":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
          <path d="M15.5 5.2a3.2 3.2 0 0 1 0 5.6" />
          <path d="M17.5 20a5.5 5.5 0 0 0-2.6-4.7" />
        </svg>
      );
    default:
      return null;
  }
}

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "create", label: "Create Session", icon: "create" },
  { id: "live", label: "Live Session", icon: "live" },
  { id: "history", label: "Session History", icon: "history" },
  { id: "analytics", label: "Analytics", icon: "analytics" },
  { id: "reports", label: "Reports", icon: "reports" },
  { id: "participants", label: "Participants", icon: "participants" },
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
                <Icon name={item.icon} />
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
            <span aria-hidden="true">
              <Icon name="menu" size={20} />
            </span>
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
