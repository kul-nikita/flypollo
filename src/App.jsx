import { useState } from "react";
import Logo from "./components/Logo";
import Landing from "./pages/Landing";
import Entry from "./pages/Entry";
import Dashboard from "./pages/Dashboard";
import Admin from "./pages/Admin";

export default function App() {
  const [view, setView] = useState({ name: "landing" });

  const onHome = () => setView({ name: "landing" });

  return (
    <div className="app">
      <header className="app-header">
        <button
          type="button"
          className="brand-btn"
          onClick={view.name === "landing" ? undefined : onHome}
          aria-label="FlyPollo home"
        >
          <Logo withText />
        </button>
      </header>
      <main className="app-main">
        {view.name === "landing" && (
          <Landing
            onEnter={(email) => setView({ name: "entry", email })}
          />
        )}
        {view.name === "entry" && (
          <Entry
            email={view.email}
            onBack={onHome}
            onAdmin={(email) => setView({ name: "admin", email })}
            onParticipant={(profile) => setView({ name: "participant", profile })}
          />
        )}
        {view.name === "participant" && (
          <Dashboard profile={view.profile} onSignOut={onHome} />
        )}
        {view.name === "admin" && (
          <Admin adminEmail={view.email} onSignOut={onHome} />
        )}
      </main>
    </div>
  );
}
