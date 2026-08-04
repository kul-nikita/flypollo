import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { ref, onValue } from "firebase/database";
import { db, database, configured } from "../firebase";
import { sessionDocId } from "../lib/session";
import { useToast } from "../components/Toasts";
import ConfirmDialog from "../components/ConfirmDialog";

const DEFAULT_LIVE = { questionIndex: 0, status: "idle" };

function ConnectionPill({ connected }) {
  return (
    <span className={`status-pill ${connected ? "status-online" : "status-offline"}`}>
      <span className="status-dot" aria-hidden="true" />
      {connected ? "Connected" : "Reconnecting…"}
    </span>
  );
}

function WaitingRoom({ profile, connected }) {
  const firstName = (profile.name || "").split(" ")[0] || profile.name;
  return (
    <div className="dashboard-waiting">
      <ConnectionPill connected={connected} />
      <div className="waiting-avatar" aria-hidden="true">
        {(profile.name || "?").slice(0, 1).toUpperCase()}
      </div>
      <h1 className="waiting-title">
        Welcome back, {firstName}
      </h1>
      <p className="waiting-sub">
        {profile.institution}
        {profile.designation ? ` · ${profile.designation}` : ""}
      </p>
      <div className="waiting-loader" aria-hidden="true">
        <span className="loader-dot" />
        <span className="loader-dot" />
        <span className="loader-dot" />
      </div>
      <p className="waiting-hint">
        Waiting for the presenter to start…
      </p>
    </div>
  );
}

export default function Dashboard({ profile, onSignOut }) {
  const [connected, setConnected] = useState(false);
  const [live, setLive] = useState(DEFAULT_LIVE);
  const [questions, setQuestions] = useState([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [submitted, setSubmitted] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    if (!configured || !database) return;
    const connectedRef = ref(database, ".info/connected");
    const off = onValue(connectedRef, (snap) => {
      setConnected(Boolean(snap.val()));
    });
    return () => off();
  }, []);

  useEffect(() => {
    if (!configured || !database) return;
    const liveRef = ref(database, "session/live");
    const off = onValue(liveRef, (snap) => {
      const value = snap.val();
      if (value && typeof value.status === "string") {
        setLive(value);
      } else {
        setLive(DEFAULT_LIVE);
      }
    });
    return () => off();
  }, []);

  const liveSessionId = sessionDocId(live);

  useEffect(() => {
    if (live.status !== "live" || !liveSessionId) return;
    setLoadingQuestions(true);
    getDoc(doc(db, "sessions", liveSessionId))
      .then((snap) => {
        setQuestions(snap.exists() ? snap.data().questions || [] : []);
      })
      .catch(() => setQuestions([]))
      .finally(() => setLoadingQuestions(false));
  }, [live.status, liveSessionId]);

  useEffect(() => {
    setSelectedAnswer(null);
    setSaving(false);
    if (live.status !== "live" || !profile || questions.length === 0) return;
    let cancelled = false;
    getDoc(doc(db, "sessions", liveSessionId, "answers", String(live.questionIndex)))
      .then((snap) => {
        if (cancelled) return;
        const entry = snap.exists() ? snap.data()[profile.participantId] : null;
        if (entry && typeof entry.selectedIndex === "number") {
          setSubmitted((map) => ({ ...map, [live.questionIndex]: entry.selectedIndex }));
          setSelectedAnswer(entry.selectedIndex);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [live.questionIndex, live.status, liveSessionId, profile, questions.length]);

  async function handleAnswer(optionIndex) {
    if (!profile || live.status !== "live") return;
    const qIndex = live.questionIndex;
    if (submitted[qIndex] !== undefined || selectedAnswer !== null) return;
    setError("");
    setSaving(true);
    setSelectedAnswer(optionIndex);
    try {
      await setDoc(
        doc(db, "sessions", liveSessionId, "answers", String(qIndex)),
        {
          [profile.participantId]: {
            selectedIndex: optionIndex,
            timestamp: new Date().toISOString(),
          },
        },
        { merge: true }
      );
      setSubmitted((map) => ({ ...map, [qIndex]: optionIndex }));
      showToast("Answer saved.", "success", 2500);
    } catch (err) {
      setSelectedAnswer(null);
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  function handleSignOut() {
    setConfirmSignOut(false);
    onSignOut();
  }

  const currentQuestion = questions[live.questionIndex] || null;
  const locked = submitted[live.questionIndex] !== undefined;
  const answeredCount = Object.keys(submitted).length;

  if (live.status === "idle") {
    return (
      <section className="dashboard">
        <WaitingRoom profile={profile} connected={connected} />
        <button type="button" className="btn btn-ghost dashboard-signout" onClick={() => setConfirmSignOut(true)}>
          Sign out
        </button>
        <ConfirmDialog
          open={confirmSignOut}
          title="Sign out?"
          message="You'll still be recognized by email next time."
          confirmLabel="Sign out"
          cancelLabel="Stay"
          onConfirm={handleSignOut}
          onCancel={() => setConfirmSignOut(false)}
        />
      </section>
    );
  }

  if (live.status === "ended") {
    return (
      <section className="dashboard">
        <div className="dashboard-card dashboard-center">
          <div className="completed-badge" aria-hidden="true">✓</div>
          <h1>That's a wrap!</h1>
          <p className="waiting-sub">
            You answered <strong>{answeredCount}</strong> of{" "}
            <strong>{questions.length || "—"}</strong> questions,{" "}
            {(profile.name || "").split(" ")[0] || "friend"}.
          </p>
          <p className="waiting-hint">Thanks for participating!</p>
        </div>
        <button type="button" className="btn btn-ghost dashboard-signout" onClick={() => setConfirmSignOut(true)}>
          Sign out
        </button>
        <ConfirmDialog
          open={confirmSignOut}
          title="Sign out?"
          message="You'll still be recognized by email next time."
          confirmLabel="Sign out"
          cancelLabel="Stay"
          onConfirm={handleSignOut}
          onCancel={() => setConfirmSignOut(false)}
        />
      </section>
    );
  }

  if (loadingQuestions || !currentQuestion) {
    return (
      <section className="dashboard">
        <ConnectionPill connected={connected} />
        <div className="dashboard-card">
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-block" />
          <div className="skeleton skeleton-block" />
          <div className="skeleton skeleton-block" />
        </div>
      </section>
    );
  }

  const progress = Math.round(((live.questionIndex + 1) / questions.length) * 100);

  return (
    <section className="dashboard">
      <div className="quiz-header">
        <ConnectionPill connected={connected} />
        <span className="quiz-progress-label">
          Question {live.questionIndex + 1} of {questions.length}
        </span>
      </div>
      <div className="quiz-progress-track" role="presentation">
        <div className="quiz-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="dashboard-card quiz-card">
        <h1 className="quiz-question">{currentQuestion.question}</h1>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="answer-grid">
          {currentQuestion.options.map((option, index) => (
            <button
              key={index}
              type="button"
              className={`answer-btn ${selectedAnswer === index ? "selected" : ""}`}
              onClick={() => handleAnswer(index)}
              disabled={locked || saving}
            >
              <span className="answer-letter" aria-hidden="true">
                {String.fromCharCode(65 + index)}
              </span>
              {option}
            </button>
          ))}
        </div>
        {saving && <p className="hint">Saving your answer…</p>}
        {locked && selectedAnswer !== null && (
          <p className="answer-locked" role="status">
            <span className="check-badge" aria-hidden="true">✓</span>
            Answer locked — you chose {String.fromCharCode(65 + selectedAnswer)}.
          </p>
        )}
      </div>

      <button type="button" className="btn btn-ghost dashboard-signout" onClick={() => setConfirmSignOut(true)}>
        Sign out
      </button>
      <ConfirmDialog
        open={confirmSignOut}
        title="Sign out?"
        message="You'll still be recognized by email next time."
        confirmLabel="Sign out"
        cancelLabel="Stay"
        onConfirm={handleSignOut}
        onCancel={() => setConfirmSignOut(false)}
      />
    </section>
  );
}
