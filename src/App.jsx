import { useState } from "react";
import Logo from "./components/Logo";
import Landing from "./pages/Landing";
import Entry from "./pages/Entry";
import Dashboard from "./pages/Dashboard";
import Admin from "./pages/Admin";
import { clearParticipantData, loadJoinedSession } from "./lib/participant";

function parseRoomParam() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("room") || "";
  } catch {
    return "";
  }
}

export default function App() {
  const [view, setView] = useState({ name: "landing" });
  const [pendingRoom, setPendingRoom] = useState(() => parseRoomParam());

  const goHome = () => {
    setPendingRoom("");
    setView({ name: "landing" });
  };

  const onSignOut = () => {
    clearParticipantData();
    setView({ name: "landing" });
  };

  return (
    <div className="app">
      {view.name === "admin" ? (
        <Admin adminEmail={view.email} onSignOut={onSignOut} />
      ) : (
        <>
          <header className="app-header">
            <button
              type="button"
              className="brand-btn"
              onClick={view.name === "landing" ? undefined : goHome}
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
                onBack={goHome}
                onAdmin={(email) => setView({ name: "admin", email })}
                onParticipant={(profile) => {
                  setView({
                    name: "dashboard",
                    profile,
                    joinedSession: loadJoinedSession(),
                    initialRoomCode: pendingRoom,
                  });
                  setPendingRoom("");
                }}
              />
            )}
            {view.name === "dashboard" && (
              <Dashboard
                profile={view.profile}
                joinedSession={view.joinedSession}
                initialRoomCode={view.initialRoomCode}
                onJoined={(session) =>
                  setView({
                    name: "dashboard",
                    profile: view.profile,
                    joinedSession: session,
                  })
                }
                onSignOut={onSignOut}
              />
            )}
          </main>
        </>
      )}
    </div>
  );
}
