import { useEffect, useRef, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { ref, onValue, set } from "firebase/database";
import { db, database, configured } from "../firebase";
import { formatDate } from "../lib/session";
import { DEFAULT_LIVE, livePath } from "../lib/live";
import { useCountdown } from "../lib/useCountdown";
import {
  clearJoinedSession,
  findSessionByRoomCode,
  saveJoinedSession,
} from "../lib/participant";
import { listParticipantSessions } from "../lib/report";
import { useToast } from "../components/Toasts";
import ConfirmDialog from "../components/ConfirmDialog";

const REACTIONS = ["👍", "❤️", "👏", "😂", "🎉"];

function ReactionsLauncher({ sessionId, participantId }) {
  const [open, setOpen] = useState(false);
  if (!sessionId || !participantId) return null;
  function send(emoji) {
    if (!configured || !database) return;
    set(
      ref(database, `sessions/${sessionId}/reactions/${participantId}`),
      { emoji, at: Date.now() }
    ).catch(() => {});
    setOpen(false);
  }
  return (
    <div className="reactions">
      {open && (
        <div className="reactions-panel" role="toolbar" aria-label="Reactions">
          {REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="reaction-btn"
              onClick={() => send(emoji)}
              aria-label={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="reactions-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-label="Send a reaction"
        aria-expanded={open}
      >
        <span aria-hidden="true">⚡</span>
      </button>
    </div>
  );
}

function ConnectionPill({ connected }) {
  return (
    <span className={`status-pill ${connected ? "status-online" : "status-offline"}`}>
      <span className="status-dot" aria-hidden="true" />
      {connected ? "Connected" : "Reconnecting…"}
    </span>
  );
}

function extractRoomCode(raw) {
  const value = String(raw || "").trim();
  try {
    if (/^https?:\/\//i.test(value)) {
      const room = new URL(value).searchParams.get("room");
      if (room) return room.trim().toUpperCase();
      return "";
    }
  } catch {
    // fall through to raw code check
  }
  if (/^FP-\d{4,6}$/i.test(value)) return value.toUpperCase();
  if (/^\d{4,6}$/.test(value)) return value.toUpperCase();
  return "";
}

function ScanQr({ onDetected, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let animationFrame = 0;

    function tick() {
      if (cancelled || !detectorRef.current || !videoRef.current) return;
      detectorRef.current
        .detect(videoRef.current)
        .then((codes) => {
          if (cancelled) return;
          if (codes && codes.length > 0 && codes[0].rawValue) {
            onDetected(codes[0].rawValue);
            return;
          }
          animationFrame = requestAnimationFrame(tick);
        })
        .catch(() => {
          animationFrame = requestAnimationFrame(tick);
        });
    }

    async function setup() {
      if (!("BarcodeDetector" in window)) {
        setError(
          "QR scanning isn't supported in this browser. Enter the room code instead."
        );
        return;
      }
      try {
        const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        detectorRef.current = detector;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        tick();
      } catch {
        setError(
          "Camera unavailable. Enter the room code instead."
        );
      }
    }

    setup();
    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrame);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="scan-qr">
      <video
        ref={videoRef}
        className="scan-video"
        playsInline
        muted
        aria-label="QR code scanner"
      />
      {error && <p className="error" role="alert">{error}</p>}
      <p className="field-hint">Point your camera at the presenter's QR code.</p>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={onClose}
      >
        Cancel scan
      </button>
    </div>
  );
}

export default function Dashboard({
  profile,
  joinedSession,
  initialRoomCode = "",
  onJoined,
  onProfile,
  onSignOut,
  onLeaveSession,
}) {
  const [connected, setConnected] = useState(false);
  const [live, setLive] = useState(DEFAULT_LIVE);
  const [questions, setQuestions] = useState([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [submitted, setSubmitted] = useState({});
  const [wordText, setWordText] = useState("");
  const [timedOut, setTimedOut] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [roomCode, setRoomCode] = useState(initialRoomCode || "");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [pastSessions, setPastSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const autoJoinTried = useRef(false);
  const joinLockRef = useRef(false);
  const answerLockRef = useRef(false);
  const { showToast } = useToast();

  useEffect(() => {
    if (!configured || !database) return;
    const connectedRef = ref(database, ".info/connected");
    const off = onValue(connectedRef, (snap) => {
      setConnected(Boolean(snap.val()));
    });
    return () => off();
  }, []);

  const liveSessionId = joinedSession?.sessionId || null;

  useEffect(() => {
    if (!configured || !database || !liveSessionId) {
      setLive(DEFAULT_LIVE);
      return;
    }
    const off = onValue(ref(database, livePath(liveSessionId)), (snap) => {
      const value = snap.val();
      if (value && typeof value.status === "string") {
        setLive(value);
      } else {
        setLive(DEFAULT_LIVE);
      }
    });
    return () => off();
  }, [liveSessionId]);

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
    setWordText("");
    setTimedOut(false);
    setSaving(false);
    if (live.status !== "live" || !profile || questions.length === 0) return;
    let cancelled = false;
    getDoc(doc(db, "sessions", liveSessionId, "answers", String(live.questionIndex)))
      .then((snap) => {
        if (cancelled) return;
        const entry = snap.exists() ? snap.data()[profile.participantId] : null;
        if (!entry) return;
        if (typeof entry.selectedIndex === "number") {
          setSubmitted((map) => ({ ...map, [live.questionIndex]: entry.selectedIndex }));
          setSelectedAnswer(entry.selectedIndex);
        } else if (typeof entry.text === "string" && entry.text.trim()) {
          setSubmitted((map) => ({ ...map, [live.questionIndex]: entry.text }));
          setWordText(entry.text);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    live.questionIndex,
    live.questionShownAt,
    live.status,
    liveSessionId,
    profile,
    questions.length,
  ]);

  useEffect(() => {
    if (!configured || !db || !profile?.participantId) {
      setSessionsLoading(false);
      return;
    }
    let cancelled = false;
    listParticipantSessions(db, profile.participantId)
      .then((list) => {
        if (!cancelled) setPastSessions(list);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (live.status !== "ended" || !profile?.participantId) return;
    let cancelled = false;
    listParticipantSessions(db, profile.participantId)
      .then((list) => {
        if (!cancelled) setPastSessions(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [live.status, profile?.participantId]);

  useEffect(() => {
    if (!initialRoomCode || autoJoinTried.current) return;
    autoJoinTried.current = true;
    joinRoom(initialRoomCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function joinRoom(code) {
    if (joinLockRef.current) return;
    const normalized = String(code || "").trim().toUpperCase();
    if (!normalized) {
      setJoinError("Enter the room code shown by your presenter.");
      return;
    }
    joinLockRef.current = true;
    setJoining(true);
    setJoinError("");
    try {
      if (!configured) {
        throw new Error(
          "Firebase is not configured. Add the VITE_FIREBASE_* variables to .env and restart."
        );
      }
      const session = await findSessionByRoomCode(normalized);
      if (!session) {
        setJoinError("Room code not found.");
        showToast("Room code not found.", "error");
        return;
      }
      saveJoinedSession(session);
      setRoomCode(normalized);
      onJoined(session);
    } catch (err) {
      setJoinError(err.message);
      showToast(err.message, "error");
    } finally {
      setJoining(false);
      joinLockRef.current = false;
    }
  }

  function handleJoinSubmit(event) {
    event.preventDefault();
    joinRoom(roomCode);
  }

  function handleScanResult(raw) {
    setScanning(false);
    const code = extractRoomCode(raw);
    if (!code) {
      showToast("That QR doesn't look like a FlyGamify room code.", "error");
      return;
    }
    setRoomCode(code);
    joinRoom(code);
  }

  function handleLeaveSession() {
    clearJoinedSession();
    setLive(DEFAULT_LIVE);
    setQuestions([]);
    setSubmitted({});
    setSelectedAnswer(null);
    setWordText("");
    setTimedOut(false);
    setRoomCode("");
    setJoinError("");
    if (onLeaveSession) onLeaveSession();
  }

  async function handleAnswer(optionIndex) {
    if (!profile || live.status !== "live") return;
    if (answerLockRef.current) return;
    const qIndex = live.questionIndex;
    if (submitted[qIndex] !== undefined || selectedAnswer !== null || timedOut) return;
    answerLockRef.current = true;
    setError("");
    setSaving(true);
    setSelectedAnswer(optionIndex);
    const shownAt = Number(live.questionShownAt) || null;
    const responseMs =
      shownAt && shownAt > 0 ? Math.max(0, Date.now() - shownAt) : null;
    try {
      await setDoc(
        doc(db, "sessions", liveSessionId, "answers", String(qIndex)),
        {
          [profile.participantId]: {
            selectedIndex: optionIndex,
            timestamp: new Date().toISOString(),
            ...(responseMs !== null ? { responseMs } : {}),
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
      answerLockRef.current = false;
    }
  }

  async function handleWordSubmit() {
    if (!profile || live.status !== "live") return;
    if (answerLockRef.current) return;
    const qIndex = live.questionIndex;
    const text = wordText.trim();
    if (!text || submitted[qIndex] !== undefined || timedOut) return;
    answerLockRef.current = true;
    setError("");
    setSaving(true);
    const shownAt = Number(live.questionShownAt) || null;
    const responseMs =
      shownAt && shownAt > 0 ? Math.max(0, Date.now() - shownAt) : null;
    try {
      await setDoc(
        doc(db, "sessions", liveSessionId, "answers", String(qIndex)),
        {
          [profile.participantId]: {
            text,
            timestamp: new Date().toISOString(),
            ...(responseMs !== null ? { responseMs } : {}),
          },
        },
        { merge: true }
      );
      setSubmitted((map) => ({ ...map, [qIndex]: text }));
      showToast("Response saved.", "success", 2500);
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setSaving(false);
      answerLockRef.current = false;
    }
  }

  function handleSignOut() {
    setConfirmSignOut(false);
    onSignOut();
  }

  const currentQuestion = questions[live.questionIndex] || null;
  const locked = submitted[live.questionIndex] !== undefined;
  const remaining = useCountdown(
    currentQuestion?.timerSeconds ? live.questionShownAt : null,
    currentQuestion?.timerSeconds || 0
  );

  useEffect(() => {
    const hasTimer = currentQuestion?.timerSeconds > 0;
    const shownAt = Number(live.questionShownAt) || 0;
    if (
      !hasTimer ||
      !shownAt ||
      remaining > 0 ||
      locked ||
      live.status !== "live"
    ) {
      return;
    }
    const expiresAt = shownAt + currentQuestion.timerSeconds * 1000;
    if (Date.now() < expiresAt) return;
    setTimedOut(true);
  }, [
    remaining,
    locked,
    live.status,
    live.questionShownAt,
    currentQuestion?.timerSeconds,
  ]);

  const answeredCount = Object.keys(submitted).length;
  const firstName = (profile.name || "").split(" ")[0] || profile.name;
  const initial = (profile.name || "?").slice(0, 1).toUpperCase();
  const currentResult = joinedSession
    ? pastSessions.find(
        (s) =>
          s.roomCode === joinedSession.roomCode ||
          s.sessionId === joinedSession.sessionId
      )
    : null;

  if (live.status === "live") {
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
          <button
            type="button"
            className="btn btn-ghost dashboard-signout"
            onClick={() => setConfirmSignOut(true)}
          >
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

    const progress = Math.round(
      ((live.questionIndex + 1) / questions.length) * 100
    );

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
          {currentQuestion.timerSeconds > 0 && live.status === "live" && (
            <div
              className={`quiz-timer ${remaining <= 5 && !locked ? "quiz-timer-warn" : ""}`}
              role="timer"
              aria-label={`Time remaining: ${remaining} seconds`}
            >
              <span className="quiz-timer-value">{remaining}s</span>
            </div>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          {currentQuestion.type === "wordcloud" ? (
            <div className="wordcloud-answer">
              <input
                type="text"
                value={wordText}
                onChange={(event) => setWordText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleWordSubmit();
                }}
                placeholder="Type a word or short phrase…"
                aria-label="Your word"
                disabled={locked || timedOut || saving}
                maxLength={60}
              />
              <button
                type="button"
                className="btn btn-primary wordcloud-submit"
                onClick={handleWordSubmit}
                disabled={locked || timedOut || saving || !wordText.trim()}
              >
                Submit
              </button>
            </div>
          ) : (
            <div className="answer-grid">
              {currentQuestion.options.map((option, index) => (
                <button
                  key={index}
                  type="button"
                  className={`answer-btn ${selectedAnswer === index ? "selected" : ""}`}
                  onClick={() => handleAnswer(index)}
                  disabled={locked || timedOut || saving}
                >
                  <span className="answer-letter" aria-hidden="true">
                    {String.fromCharCode(65 + index)}
                  </span>
                  {option}
                </button>
              ))}
            </div>
          )}
          {saving && <p className="hint">Saving your answer…</p>}
          {timedOut && !locked && (
            <p className="hint" role="status">Time's up for this question.</p>
          )}
          {locked && selectedAnswer !== null && (
            <p className="answer-locked" role="status">
              <span className="check-badge" aria-hidden="true">✓</span>
              Answer locked — you chose {String.fromCharCode(65 + selectedAnswer)}.
            </p>
          )}
          {locked && selectedAnswer === null && (
            <p className="answer-locked" role="status">
              <span className="check-badge" aria-hidden="true">✓</span>
              Response locked — you sent “{wordText}”.
            </p>
          )}
        </div>

        <ReactionsLauncher
          sessionId={liveSessionId}
          participantId={profile.participantId}
        />

        <button
          type="button"
          className="btn btn-ghost dashboard-signout"
          onClick={handleLeaveSession}
        >
          Leave room
        </button>

        <button
          type="button"
          className="btn btn-ghost dashboard-signout"
          onClick={() => setConfirmSignOut(true)}
        >
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

  return (
    <section className="pdash">
      <header className="pdash-head">
        <div>
          <p className="pdash-eyebrow">Participant dashboard</p>
          <h1 className="pdash-welcome">Welcome back, {firstName}</h1>
          <p className="pdash-sub">
            {profile.institution}
            {profile.designation ? ` · ${profile.designation}` : ""}
          </p>
        </div>
        <div className="pdash-head-actions">
          <ConnectionPill connected={connected} />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onProfile}
          >
            Profile
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setConfirmSignOut(true)}
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="pdash-grid">
        <div className="pdash-main">
          {!joinedSession && (
            <div className="pdash-card pdash-quickjoin">
              <h2 className="pdash-card-title">Join Today's Session</h2>
              <p className="pdash-card-sub">
                Enter the room code shown by your presenter, or scan the QR on
                screen.
              </p>
              <form className="quickjoin-form" onSubmit={handleJoinSubmit}>
                <input
                  type="text"
                  value={roomCode}
                  onChange={(event) => {
                    setRoomCode(event.target.value.toUpperCase());
                    setJoinError("");
                  }}
                  placeholder="4829"
                  autoCapitalize="characters"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                  aria-label="Room code"
                  disabled={joining}
                  required
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={joining}
                >
                  {joining ? "Joining…" : "Join Session"}
                </button>
              </form>
              {joinError && (
                <p className="error" role="alert">{joinError}</p>
              )}
              <div className="quickjoin-or" aria-hidden="true">
                <span>OR</span>
              </div>
              {scanning ? (
                <ScanQr
                  onDetected={handleScanResult}
                  onClose={() => setScanning(false)}
                />
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary btn-block"
                  onClick={() => setScanning(true)}
                  disabled={joining}
                >
                  Scan QR
                </button>
              )}
            </div>
          )}

          {joinedSession && live.status === "idle" && (
            <div className="pdash-card pdash-current">
              <div className="pdash-current-head">
                <span className="pdash-current-label">Current Session</span>
              </div>
              <div className="joined-session-card">
                <span className="joined-session-label">Session</span>
                <span className="joined-session-name">
                  {joinedSession.sessionName}
                </span>
                <span className="joined-session-room">
                  {joinedSession.roomCode}
                </span>
              </div>
              <div className="waiting-loader" aria-hidden="true">
                <span className="loader-dot" />
                <span className="loader-dot" />
                <span className="loader-dot" />
              </div>
              <p className="waiting-hint">
                Waiting for the presenter to start…
              </p>
              <div className="pdash-results-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-block"
                  onClick={handleLeaveSession}
                >
                  Leave room
                </button>
              </div>
            </div>
          )}

          {joinedSession && live.status === "ended" && (
            <div className="pdash-card pdash-results">
              <div className="completed-badge" aria-hidden="true">✓</div>
              <h2 className="pdash-card-title">That's a wrap!</h2>
              <p className="pdash-results-line">
                You answered <strong>{answeredCount}</strong> of{" "}
                <strong>{questions.length || "—"}</strong> questions,{" "}
                {firstName}.
              </p>
              {currentResult && (
                <p className="pdash-score-line">
                  Your score:{" "}
                  <strong className="pdash-score">
                    {currentResult.scorePct}%
                  </strong>
                  <span className="pdash-score-detail">
                    {currentResult.correct}/{currentResult.questionCount} correct
                  </span>
                </p>
              )}
              <p className="waiting-hint">Thanks for participating!</p>
              <div className="pdash-results-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  onClick={handleLeaveSession}
                >
                  Join another session
                </button>
              </div>
            </div>
          )}
        </div>

        <aside className="pdash-side">
          <div className="pdash-card pdash-profile">
            <div className="pdash-profile-head">
              <span className="pdash-profile-avatar" aria-hidden="true">
                {initial}
              </span>
              <div className="pdash-profile-id">
                <h3 className="pdash-profile-name">{profile.name}</h3>
                <p className="pdash-profile-email">{profile.email}</p>
              </div>
            </div>
            <dl className="pdash-profile-rows">
              <div className="pdash-profile-row">
                <dt>Institution</dt>
                <dd>{profile.institution || "—"}</dd>
              </div>
              <div className="pdash-profile-row">
                <dt>Designation</dt>
                <dd>{profile.designation || "—"}</dd>
              </div>
            </dl>
          </div>

          <div className="pdash-card">
            <h3 className="pdash-card-title">Recent Scores</h3>
            {sessionsLoading ? (
              <div className="skeleton skeleton-line" />
            ) : pastSessions.length === 0 ? (
              <p className="pdash-empty">
                No scores yet. Answer a live quiz and your results will show up
                here.
              </p>
            ) : (
              <ul className="score-list">
                {pastSessions.slice(0, 5).map((s) => (
                  <li key={s.sessionId} className="score-row">
                    <div className="score-info">
                      <span className="score-name">{s.sessionName}</span>
                      <span className="score-date">
                        {formatDate(s.sessionDate)}
                      </span>
                    </div>
                    <span
                      className={`score-pct ${
                        s.scorePct >= 60 ? "score-good" : "score-low"
                      }`}
                    >
                      {s.scorePct}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="pdash-card">
            <h3 className="pdash-card-title">Past Sessions</h3>
            {sessionsLoading ? (
              <div className="skeleton skeleton-line" />
            ) : pastSessions.length === 0 ? (
              <p className="pdash-empty">
                You haven't joined any sessions yet.
              </p>
            ) : (
              <ul className="pdash-session-list">
                {pastSessions.map((s) => (
                  <li key={s.sessionId} className="pdash-session-item">
                    <span className="pdash-session-name">{s.sessionName}</span>
                    <span className="pdash-session-meta">
                      {formatDate(s.sessionDate)}
                      {s.roomCode ? ` · ${s.roomCode}` : ""}
                    </span>
                    <span className="pdash-session-score">
                      {s.answered}/{s.questionCount} answered · {s.scorePct}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmSignOut}
        title="Sign out?"
        message="You'll still be recognized by email next time."
        confirmLabel="Sign out"
        cancelLabel="Stay"
        onConfirm={handleSignOut}
        onCancel={() => setConfirmSignOut(false)}
      />

      <ReactionsLauncher
        sessionId={liveSessionId}
        participantId={profile.participantId}
      />
    </section>
  );
}
