import { useEffect, useRef, useState } from "react";
import { configured } from "../firebase";
import { findSessionByRoomCode, saveJoinedSession } from "../lib/participant";
import { useToast } from "../components/Toasts";

export default function Join({ profile, initialRoomCode = "", onBack, onJoined }) {
  const [roomCode, setRoomCode] = useState(initialRoomCode || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const autoTried = useRef(false);
  const { showToast } = useToast();

  async function join(code) {
    setBusy(true);
    setError("");
    try {
      if (!configured) {
        throw new Error(
          "Firebase is not configured. Add the VITE_FIREBASE_* variables to .env and restart."
        );
      }
      const session = await findSessionByRoomCode(code);
      if (!session) {
        setError("Room code not found.");
        showToast("Room code not found.", "error");
        return;
      }
      saveJoinedSession(session);
      onJoined(session);
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!initialRoomCode || autoTried.current) return;
    autoTried.current = true;
    join(initialRoomCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleJoin(event) {
    event.preventDefault();
    const code = roomCode.trim().toUpperCase();
    if (!code) {
      setError("Enter the room code shown by your presenter.");
      return;
    }
    join(code);
  }

  return (
    <div className="flow-card flow-narrow">
      <h1 className="flow-heading">Join Live Session</h1>
      <p className="flow-sub">
        {profile.name} · {profile.institution} — enter the room code shown by
        your presenter.
      </p>
      <form className="form" onSubmit={handleJoin}>
        <label className="field">
          <span className="field-label">Room Code</span>
          <input
            type="text"
            value={roomCode}
            onChange={(event) => {
              setRoomCode(event.target.value.toUpperCase());
              setError("");
            }}
            placeholder="4829"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
            aria-label="Room code"
            disabled={busy}
            required
          />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={busy}
        >
          {busy ? "Joining…" : "Join Session"}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-block"
          onClick={onBack}
          disabled={busy}
        >
          Back
        </button>
      </form>
      <p className="field-hint join-hint">
        Ask your presenter for today's room code.
      </p>
    </div>
  );
}
