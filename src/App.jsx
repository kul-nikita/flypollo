import { useState } from "react";
import Logo from "./components/Logo";
import Landing from "./pages/Landing";
import Entry from "./pages/Entry";
import Dashboard from "./pages/Dashboard";
import Profile from "./pages/Profile";
import Admin from "./pages/Admin";
import { isAdminEmail } from "./config/admin";
import {
  clearParticipantData,
  loadAdminEmail,
  loadJoinedSession,
  loadSavedProfile,
  saveProfile,
} from "./lib/participant";

function parseRoomParam() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("room") || "";
  } catch {
    return "";
  }
}

function resolveInitialView() {
  const profile = loadSavedProfile();
  if (profile) {
    if (isAdminEmail(profile.email)) {
      return { name: "admin", email: profile.email };
    }
    return {
      name: "dashboard",
      profile,
      joinedSession: loadJoinedSession(),
      initialRoomCode: parseRoomParam(),
    };
  }
  const adminEmail = loadAdminEmail();
  if (adminEmail && isAdminEmail(adminEmail)) {
    return { name: "admin", email: adminEmail };
  }
  return { name: "landing" };
}

export default function App() {
  const [view, setView] = useState(resolveInitialView);
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
              className={`brand-btn${view.name === "landing" ? " brand-btn-static" : ""}`}
              onClick={view.name === "landing" ? undefined : goHome}
              aria-label="FlyGamify home"
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
                onLeaveSession={() =>
                  setView({
                    name: "dashboard",
                    profile: view.profile,
                    joinedSession: null,
                    initialRoomCode: "",
                  })
                }
                onProfile={() =>
                  setView({ name: "profile", profile: view.profile })
                }
                onSignOut={onSignOut}
              />
            )}
            {view.name === "profile" && (
              <Profile
                profile={view.profile}
                onBack={() =>
                  setView({
                    name: "dashboard",
                    profile: view.profile,
                    joinedSession: loadJoinedSession(),
                    initialRoomCode: "",
                  })
                }
                onSaved={(updated) => {
                  saveProfile(updated);
                  setView({
                    name: "dashboard",
                    profile: updated,
                    joinedSession: loadJoinedSession(),
                    initialRoomCode: "",
                  });
                }}
              />
            )}
          </main>
        </>
      )}
    </div>
  );
}
