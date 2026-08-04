import { useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
} from "firebase/firestore";
import { ref, onValue, set } from "firebase/database";
import { db, database, configured } from "../firebase";
import {
  todayLocal,
  defaultSessionName,
  formatDate,
  newRoomCode,
  newSessionId,
  newSessionRecord,
  normalizeStatus,
  sessionDocId,
} from "../lib/session";
import { listSessions, sessionToCsv, csvFilename } from "../lib/report";
import { useToast } from "../components/Toasts";
import ConfirmDialog from "../components/ConfirmDialog";

const FUNCTION_URL = "/.netlify/functions/generate-mcq";
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_LIVE = { questionIndex: 0, status: "idle" };

const STATUS_META = {
  draft: { label: "Draft", className: "chip-draft" },
  published: { label: "Published", className: "chip-published" },
  live: { label: "Live", className: "chip-live" },
  completed: { label: "Completed", className: "chip-completed" },
};

function emptyQuestion() {
  return { question: "", options: ["", "", "", ""], correctIndex: 0 };
}

function validationError(questions) {
  if (questions.length === 0) {
    return "Add at least one question before continuing.";
  }
  const invalid = questions.some(
    (q) =>
      !q.question.trim() ||
      q.options.length !== 4 ||
      q.options.some((option) => !option.trim())
  );
  if (invalid) {
    return "Every question needs text and 4 non-empty options.";
  }
  return "";
}

function ConnectionPill({ connected }) {
  return (
    <span className={`status-pill ${connected ? "status-online" : "status-offline"}`}>
      <span className="status-dot" aria-hidden="true" />
      {connected ? "Connected" : "Offline"}
    </span>
  );
}

function StatusChip({ status }) {
  const meta = STATUS_META[normalizeStatus(status)] || STATUS_META.draft;
  return <span className={`status-chip ${meta.className}`}>{meta.label}</span>;
}

function SessionRow({ session, onOpen, onDownload }) {
  return (
    <div className="session-row">
      <div className="session-row-main">
        <div className="session-row-head">
          <h4 className="session-row-name">{session.sessionName}</h4>
          <StatusChip status={session.status} />
        </div>
        <p className="session-row-meta">
          {formatDate(session.sessionDate)}
          {session.description ? ` · ${session.description}` : ""}
        </p>
      </div>
      <div className="session-row-stats">
        <span className="session-stat">
          <strong>{session.participantCount}</strong> participants
        </span>
        <span className="session-stat">
          <strong>{session.avgScore}%</strong> avg score
        </span>
      </div>
      <div className="session-row-actions">
        {onDownload && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onDownload}
          >
            Download CSV
          </button>
        )}
        {onOpen && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onOpen}
          >
            Open
          </button>
        )}
      </div>
    </div>
  );
}

export default function Admin({ adminEmail, onSignOut }) {
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState([]);
  const [session, setSession] = useState(null);
  const [createForm, setCreateForm] = useState({
    sessionName: "",
    description: "",
    sessionDate: todayLocal(),
  });
  const [creating, setCreating] = useState(false);
  const [file, setFile] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [live, setLive] = useState(DEFAULT_LIVE);
  const [connected, setConnected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [answerCounts, setAnswerCounts] = useState([0, 0, 0, 0]);
  const [participantCount, setParticipantCount] = useState(0);
  const [confirm, setConfirm] = useState({ kind: null, index: null });
  const [reportOpen, setReportOpen] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  const { showToast } = useToast();

  const joinUrl = window.location.origin + "/";
  const normalizedStatus = session ? normalizeStatus(session.status) : "draft";
  const started =
    normalizedStatus === "live" ||
    normalizedStatus === "completed" ||
    live.status === "live";
  const step = loading
    ? "loading"
    : !session
      ? "create"
      : normalizedStatus === "draft"
        ? questions.length > 0
          ? "review"
          : "upload"
        : "live";
  const liveSessionId = sessionDocId(live);

  async function refreshSessions() {
    if (!configured || !db) return null;
    const list = await listSessions(db);
    setSessions(list);
    return list;
  }

  useEffect(() => {
    if (!configured || !db) {
      setLoading(false);
      return;
    }
    listSessions(db)
      .then((list) => {
        setSessions(list);
        const current =
          list.find((s) => s.status === "draft" && s.questions.length > 0) ||
          list[0];
        if (current) {
          setSession(current);
          setQuestions(current.questions);
        }
      })
      .catch((err) => {
        setError(err.message);
        showToast(err.message, "error");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!configured || !database) return;
    const connectedRef = ref(database, ".info/connected");
    const offConnected = onValue(connectedRef, (snap) => {
      setConnected(Boolean(snap.val()));
    });
    const liveRef = ref(database, "session/live");
    const offLive = onValue(liveRef, (snap) => {
      const value = snap.val();
      if (value && typeof value.status === "string") {
        setLive(value);
      } else {
        setLive(DEFAULT_LIVE);
      }
    });
    return () => {
      offConnected();
      offLive();
    };
  }, []);

  useEffect(() => {
    if (!session?.roomCode || normalizedStatus === "draft") {
      setQrDataUrl("");
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(joinUrl, {
      width: 240,
      margin: 1,
      color: { dark: "#0f172a", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [session?.roomCode, normalizedStatus, joinUrl]);

  useEffect(() => {
    if (!liveSessionId || normalizedStatus === "draft" || !configured || !db) {
      return;
    }
    const answersRef = doc(
      db,
      "sessions",
      liveSessionId,
      "answers",
      String(live.questionIndex)
    );
    const unsub = onSnapshot(
      answersRef,
      (snap) => {
        const data = snap.data() || {};
        const counts = [0, 0, 0, 0];
        for (const key of Object.keys(data)) {
          const entry = data[key];
          if (
            entry &&
            Number.isInteger(entry.selectedIndex) &&
            entry.selectedIndex >= 0 &&
            entry.selectedIndex <= 3
          ) {
            counts[entry.selectedIndex] += 1;
          }
        }
        setAnswerCounts(counts);
      },
      (err) => {
        setError(err.message);
        showToast(err.message, "error");
      }
    );
    return () => unsub();
  }, [liveSessionId, live.questionIndex, normalizedStatus, showToast]);

  useEffect(() => {
    if (normalizedStatus === "draft" || !session?.id || !configured || !db) {
      return;
    }
    let cancelled = false;
    getDocs(collection(db, "sessions", session.id, "answers"))
      .then((snap) => {
        if (cancelled) return;
        const ids = new Set();
        for (const answerDoc of snap.docs) {
          for (const key of Object.keys(answerDoc.data() || {})) ids.add(key);
        }
        setParticipantCount(ids.size);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session?.id, normalizedStatus, liveSessionId, live.questionIndex]);

  useEffect(() => {
    if (
      !session?.id ||
      normalizedStatus === "draft" ||
      !configured ||
      !db ||
      participantCount === session.participantCount
    ) {
      return;
    }
    const timer = setTimeout(() => {
      setDoc(
        doc(db, "sessions", session.id),
        {
          participantCount,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      ).catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [participantCount, session?.id, session?.participantCount, normalizedStatus]);

  const currentQuestion =
    normalizedStatus !== "draft" && questions.length > 0
      ? questions[Math.min(Math.max(live.questionIndex, 0), questions.length - 1)]
      : null;
  const totalAnswers = answerCounts.reduce((sum, count) => sum + count, 0);

  function writeLive(patch) {
    if (!configured || !database) return;
    set(
      ref(database, "session/live"),
      {
        questionIndex: live.questionIndex,
        status: live.status,
        sessionId: session?.id || null,
        sessionDate: session?.sessionDate || todayLocal(),
        roomCode: session?.roomCode || null,
        ...patch,
      }
    ).catch((err) => {
      setError(err.message);
      showToast(err.message, "error");
    });
  }

  function nextQuestion() {
    writeLive({
      questionIndex: Math.min(live.questionIndex + 1, questions.length - 1),
      status: "live",
    });
  }

  function prevQuestion() {
    writeLive({
      questionIndex: Math.max(live.questionIndex - 1, 0),
      status: "live",
    });
  }

  useEffect(() => {
    if (normalizedStatus !== "live") return;
    function handleKey(event) {
      if (event.key === "ArrowRight") nextQuestion();
      if (event.key === "ArrowLeft") prevQuestion();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedStatus, live.questionIndex, questions.length]);

  function selectSession(id) {
    const next = sessions.find((s) => s.id === id);
    if (!next) return;
    setSession(next);
    setQuestions(next.questions);
    setFile(null);
    setError("");
    setReportOpen(false);
  }

  function newSession() {
    setSession(null);
    setQuestions([]);
    setFile(null);
    setError("");
    setCreateForm({
      sessionName: "",
      description: "",
      sessionDate: todayLocal(),
    });
    setConfirm({ kind: null, index: null });
  }

  async function createSession(event) {
    event.preventDefault();
    setCreating(true);
    setError("");
    try {
      if (!configured || !db) {
        throw new Error(
          "Firebase is not configured. Add the VITE_FIREBASE_* variables to .env and restart."
        );
      }
      const sessionId = newSessionId();
      const record = newSessionRecord(createForm);
      await setDoc(doc(db, "sessions", sessionId), { sessionId, ...record });
      setSession({ id: sessionId, ...record });
      setQuestions([]);
      setFile(null);
      await refreshSessions();
      showToast(
        `Session "${record.sessionName}" created. Upload a transcript to begin.`,
        "success"
      );
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setCreating(false);
    }
  }

  function handleFile(event) {
    setFile(event.target.files?.[0] || null);
    setError("");
  }

  async function generate(event) {
    event.preventDefault();
    if (!file) return;
    if (!/\.txt$/i.test(file.name)) {
      setError("Please choose a .txt file.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("File is too large. Please use a transcript under 2 MB.");
      return;
    }
    setGenerating(true);
    setError("");
    try {
      const transcript = await file.text();
      if (!transcript.trim()) {
        throw new Error("The transcript file is empty.");
      }
      const res = await fetch(FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      setQuestions(data.questions || []);
      showToast(
        `${data.questions?.length || 0} questions generated. Review them below.`,
        "success"
      );
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setGenerating(false);
    }
  }

  function updateQuestion(index, patch) {
    setQuestions((items) =>
      items.map((item, i) => (i === index ? { ...item, ...patch } : item))
    );
  }

  function updateOption(index, optionIndex, value) {
    setQuestions((items) =>
      items.map((item, i) => {
        if (i !== index) return item;
        const options = item.options.map((option, oi) =>
          oi === optionIndex ? value : option
        );
        return { ...item, options };
      })
    );
  }

  function removeQuestion(index) {
    setQuestions((items) => items.filter((_, i) => i !== index));
  }

  function addQuestion() {
    setQuestions((items) => [...items, emptyQuestion()]);
  }

  function startOver() {
    setFile(null);
    setQuestions([]);
    setError("");
  }

  async function saveDraft() {
    const invalid = validationError(questions);
    if (invalid) {
      setError(invalid);
      showToast(invalid, "error");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (!configured || !db || !session?.id) {
        throw new Error("Select a session before saving a draft.");
      }
      const questionCount = questions.length;
      await setDoc(
        doc(db, "sessions", session.id),
        {
          status: "draft",
          questions,
          questionCount,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      setSession((s) =>
        s ? { ...s, status: "draft", questions, questionCount } : s
      );
      showToast("Draft saved. You can publish it any time.", "success");
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    const invalid = validationError(questions);
    if (invalid) {
      setError(invalid);
      showToast(invalid, "error");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (!configured || !db || !database || !session?.id) {
        throw new Error(
          "Firebase is not configured. Add the VITE_FIREBASE_* variables to .env and restart."
        );
      }
      const roomCode = newRoomCode();
      const publishedAt = new Date().toISOString();
      let qrDataUrl = "";
      try {
        qrDataUrl = await QRCode.toDataURL(joinUrl, {
          width: 240,
          margin: 1,
          color: { dark: "#0f172a", light: "#ffffff" },
        });
      } catch {
        qrDataUrl = "";
      }
      await setDoc(
        doc(db, "sessions", session.id),
        {
          status: "published",
          published: true,
          questions,
          questionCount: questions.length,
          roomCode,
          qrCode: qrDataUrl,
          sessionName: session.sessionName,
          sessionDate: session.sessionDate,
          publishedAt,
          publishedBy: adminEmail,
          participantCount: 0,
          updatedAt: publishedAt,
        },
        { merge: true }
      );
      setSession((s) =>
        s
          ? {
              ...s,
              status: "published",
              published: true,
              questions,
              questionCount: questions.length,
              roomCode,
              qrCode: qrDataUrl,
              publishedAt,
              publishedBy: adminEmail,
              participantCount: 0,
            }
          : s
      );
      setQrDataUrl(qrDataUrl);
      await set(ref(database, "session/live"), {
        questionIndex: 0,
        status: "idle",
        sessionId: session.id,
        sessionDate: session.sessionDate,
        roomCode,
      });
      await refreshSessions();
      showToast(
        `Session published. Room code ${roomCode} is now joinable.`,
        "success"
      );
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setSaving(false);
      setConfirm({ kind: null, index: null });
    }
  }

  async function startSession() {
    setSaving(true);
    setError("");
    try {
      if (configured && db && session?.id) {
        await setDoc(
          doc(db, "sessions", session.id),
          {
            status: "live",
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        setSession((s) => (s ? { ...s, status: "live" } : s));
      }
      writeLive({ questionIndex: 0, status: "live" });
      showToast("Quiz is live.", "success");
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function endSession() {
    setSaving(true);
    setError("");
    try {
      if (configured && db && session?.id) {
        await setDoc(
          doc(db, "sessions", session.id),
          {
            status: "completed",
            participantCount,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        setSession((s) =>
          s ? { ...s, status: "completed", participantCount } : s
        );
      }
      writeLive({ status: "ended" });
      showToast(
        "Session completed. Results are available in Reports.",
        "success"
      );
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setSaving(false);
      setConfirm({ kind: null, index: null });
    }
  }

  async function backToDraft() {
    setSaving(true);
    setError("");
    try {
      if (configured && db && session?.id) {
        await setDoc(
          doc(db, "sessions", session.id),
          {
            status: "draft",
            published: false,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        setSession((s) => (s ? { ...s, status: "draft", published: false } : s));
      }
      if (configured && database) {
        await set(ref(database, "session/live"), {
          questionIndex: 0,
          status: "idle",
        });
      }
      showToast("Back to editing. Publish again to create a fresh room code.", "info");
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setSaving(false);
      setConfirm({ kind: null, index: null });
    }
  }

  async function openReports() {
    setReportOpen(true);
    setReportLoading(true);
    setReportError("");
    try {
      if (!configured || !db) {
        throw new Error(
          "Firebase is not configured. Add the VITE_FIREBASE_* variables to .env and restart."
        );
      }
      await refreshSessions();
    } catch (err) {
      setReportError(err.message);
      showToast(err.message, "error");
    } finally {
      setReportLoading(false);
    }
  }

  function downloadSessionCsv(sessionToDownload) {
    const csv = sessionToCsv(sessionToDownload);
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = csvFilename(sessionToDownload);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  const confirmDialog =
    confirm.kind === "publish"
      ? {
          title: "Publish session?",
          points: [
            "Questions reviewed",
            "Room Code will be generated",
            "QR Code will be generated",
            "Participants will immediately be able to join",
          ],
          confirmLabel: "Publish",
        }
      : confirm.kind === "backToDraft"
        ? {
            title: "Return to editing?",
            message:
              "The published room code and QR will be hidden until you publish again.",
            confirmLabel: "Go back",
          }
        : confirm.kind === "endSession"
          ? {
              title: "End the session?",
              message:
                "Live questions will stop, the session will be marked completed, and participants will see the completion screen.",
              confirmLabel: "End session",
            }
          : confirm.kind === "signout"
            ? {
                title: "Sign out?",
                message: `Signed in as ${adminEmail}. You'll be able to sign back in with the same email.`,
                confirmLabel: "Sign out",
              }
            : null;

  function confirmAction() {
    if (confirm.kind === "publish") publish();
    else if (confirm.kind === "backToDraft") backToDraft();
    else if (confirm.kind === "endSession") endSession();
    else if (confirm.kind === "signout") onSignOut();
  }

  const stepper = [
    { label: "Create", state: session ? "done" : step === "create" ? "current" : "" },
    {
      label: "Upload",
      state:
        step === "upload"
          ? "current"
          : questions.length > 0 || normalizedStatus !== "draft"
            ? "done"
            : "",
    },
    {
      label: "Review",
      state:
        step === "review" ? "current" : normalizedStatus !== "draft" ? "done" : "",
    },
    {
      label: "Publish",
      state:
        step === "live" && !started ? "current" : started ? "done" : "",
    },
    {
      label: "Live",
      state:
        step === "live" && started
          ? "current"
          : normalizedStatus === "completed"
            ? "done"
            : "",
    },
  ];

  return (
    <section className="admin">
      <div className="admin-head">
        <div>
          <h1 className="admin-title">Presenter Console</h1>
          <p className="admin-sub">
            Signed in as <strong>{adminEmail}</strong>
          </p>
        </div>
        <div className="admin-head-actions">
          <ConnectionPill connected={connected} />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setConfirm({ kind: "signout" })}
          >
            Sign out
          </button>
        </div>
      </div>

      <ol className="stepper" aria-label="Session workflow">
        {stepper.map((item, index) => (
          <li
            key={item.label}
            className={
              item.state === "current"
                ? "step-current"
                : item.state === "done"
                  ? "step-done"
                  : ""
            }
          >
            <span className="step-num">{index + 1}</span>
            <span className="step-label">{item.label}</span>
          </li>
        ))}
      </ol>

      {error && <p className="error banner" role="alert">{error}</p>}

      {step === "loading" && (
        <div className="admin-card">
          <div className="skeleton skeleton-block" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
        </div>
      )}

      {step !== "loading" && (
        <div className="session-bar">
          <div className="session-bar-info">
            {session ? (
              <>
                <StatusChip status={normalizedStatus} />
                <h2 className="session-bar-name">{session.sessionName}</h2>
                <p className="session-bar-meta">
                  {formatDate(session.sessionDate)}
                  {session.description ? ` · ${session.description}` : ""}
                </p>
              </>
            ) : (
              <p className="admin-sub">
                Create a session to get started.
              </p>
            )}
          </div>
          <div className="session-bar-actions">
            {sessions.length > 0 && (
              <label className="field field-inline">
                <span className="field-label">Session</span>
                <select
                  value={session?.id || ""}
                  onChange={(event) => selectSession(event.target.value)}
                >
                  <option value="">— Select a session —</option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.sessionName}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={newSession}
            >
              + New session
            </button>
          </div>
        </div>
      )}

      {step === "create" && (
        <div className="admin-card">
          <h2>Create a session</h2>
          <p className="admin-sub">
            Name this session before uploading a transcript. Questions, room
            code and results all live under it.
          </p>
          <form className="form create-form" onSubmit={createSession}>
            <label className="field">
              <span className="field-label">Session Name</span>
              <input
                type="text"
                value={createForm.sessionName}
                onChange={(event) =>
                  setCreateForm((form) => ({
                    ...form,
                    sessionName: event.target.value,
                  }))
                }
                placeholder={defaultSessionName()}
                required
              />
            </label>
            <label className="field">
              <span className="field-label">Description (optional)</span>
              <input
                type="text"
                value={createForm.description}
                onChange={(event) =>
                  setCreateForm((form) => ({
                    ...form,
                    description: event.target.value,
                  }))
                }
                placeholder="e.g. Cardiology residents, morning teaching"
              />
            </label>
            <label className="field">
              <span className="field-label">Session Date</span>
              <input
                type="date"
                value={createForm.sessionDate}
                onChange={(event) =>
                  setCreateForm((form) => ({
                    ...form,
                    sessionDate: event.target.value,
                  }))
                }
              />
            </label>
            <div>
              <button
                type="submit"
                className="btn btn-primary btn-lg"
                disabled={creating}
              >
                {creating ? "Creating…" : "Create session"}
              </button>
            </div>
          </form>

          {sessions.length > 0 && (
            <div className="existing-sessions">
              <h3 className="existing-title">Existing sessions</h3>
              <div className="session-list">
                {sessions.map((s) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    onOpen={() => selectSession(s.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {step === "upload" && (
        <div className="admin-card">
          <h2>Upload a transcript</h2>
          <p className="admin-sub">
            {session?.sessionName
              ? `"${session.sessionName}" — `
              : ""}
            Drop a transcript and FlyPollo will draft ten questions for you to
            review.
          </p>
          <form onSubmit={generate} className="upload-form">
            <label className="dropzone">
              <input
                type="file"
                accept=".txt,text/plain"
                onChange={handleFile}
                aria-label="Transcript file"
              />
              <span className="dropzone-icon" aria-hidden="true">↑</span>
              {file ? (
                <span className="dropzone-text">{file.name}</span>
              ) : (
                <span className="dropzone-text">
                  Choose a .txt transcript or drag it here
                </span>
              )}
            </label>
            <button
              type="submit"
              className="btn btn-primary btn-lg"
              disabled={!file || generating}
            >
              {generating ? "Generating questions…" : "Generate questions"}
            </button>
          </form>
        </div>
      )}

      {step === "review" && (
        <>
          <div className="admin-toolbar">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={saveDraft}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setConfirm({ kind: "publish" })}
              disabled={saving || Boolean(validationError(questions))}
            >
              Publish session
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={startOver}
              disabled={saving}
            >
              Start over
            </button>
            <span className="toolbar-hint">{questions.length} questions</span>
          </div>

          <div className="question-list">
            {questions.map((q, index) => (
              <div className="admin-card question-card" key={index}>
                <div className="question-head">
                  <span className="question-number">Question {index + 1}</span>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => setConfirm({ kind: "delete", index })}
                  >
                    Delete
                  </button>
                </div>
                <label className="field">
                  <span className="field-label">Question</span>
                  <textarea
                    value={q.question}
                    onChange={(event) =>
                      updateQuestion(index, { question: event.target.value })
                    }
                    rows={2}
                    aria-label={`Question ${index + 1}`}
                  />
                </label>
                <div className="option-list">
                  {q.options.map((option, optionIndex) => (
                    <div className="option-row" key={optionIndex}>
                      <input
                        type="radio"
                        name={`correct-${index}`}
                        checked={q.correctIndex === optionIndex}
                        onChange={() =>
                          updateQuestion(index, { correctIndex: optionIndex })
                        }
                        aria-label={`Mark option ${optionIndex + 1} as correct`}
                      />
                      <input
                        type="text"
                        value={option}
                        onChange={(event) =>
                          updateOption(index, optionIndex, event.target.value)
                        }
                        aria-label={`Option ${optionIndex + 1}`}
                        placeholder={`Option ${optionIndex + 1}`}
                      />
                    </div>
                  ))}
                </div>
                <p className="field-hint">
                  The highlighted circle marks the correct answer.
                </p>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn-secondary" onClick={addQuestion}>
            + Add question
          </button>
        </>
      )}

      {step === "live" && (
        <div className="live-area">
          <div className="publish-card">
            <div className="publish-left">
              <span className={`live-badge ${normalizedStatus === "live" ? "badge-live" : normalizedStatus === "completed" ? "badge-ended" : "badge-idle"}`}>
                {normalizedStatus === "live"
                  ? "● Live"
                  : normalizedStatus === "completed"
                    ? "Completed"
                    : "Published"}
              </span>
              <h2 className="publish-room-label">Room code</h2>
              <p className="publish-room-code">{session?.roomCode}</p>
              <p className="admin-sub">
                Share this code with the room, or point participants to{" "}
                <a href={joinUrl} className="publish-link">
                  {joinUrl}
                </a>
              </p>
              <div className="publish-stat">
                <span className="publish-stat-value">{participantCount}</span>
                <span className="publish-stat-label">
                  participants answered
                </span>
              </div>
            </div>
            <div className="publish-qr">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={`QR code to open ${joinUrl}`}
                  width={180}
                  height={180}
                />
              ) : (
                <div className="skeleton skeleton-qr" />
              )}
              <p className="field-hint">Scan to open</p>
            </div>
          </div>

          <div className="admin-card">
            <div className="live-controls">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={prevQuestion}
                disabled={live.questionIndex <= 0 || saving}
              >
                ← Prev
              </button>
              <span className="live-status">
                Question {live.questionIndex + 1} of {questions.length}
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={nextQuestion}
                disabled={live.questionIndex >= questions.length - 1 || saving}
              >
                Next →
              </button>
            </div>
            <div className="live-actions">
              {normalizedStatus === "published" && live.status !== "live" && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={startSession}
                  disabled={saving}
                >
                  {saving ? "Starting…" : "Start session"}
                </button>
              )}
              {live.status === "live" && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => setConfirm({ kind: "endSession" })}
                  disabled={saving}
                >
                  End session
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setConfirm({ kind: "backToDraft" })}
                disabled={saving}
              >
                Back to editing
              </button>
            </div>
            <p className="field-hint">
              Use the ← / → arrow keys to move between questions.
            </p>

            {currentQuestion && (
              <div className="live-preview">
                <h2 className="live-preview-question">{currentQuestion.question}</h2>
                <div className="live-answers">
                  <h3 className="live-answers-title">
                    Live answers ({totalAnswers})
                  </h3>
                  {currentQuestion.options.map((option, index) => {
                    const count = answerCounts[index] || 0;
                    const pct =
                      totalAnswers > 0
                        ? Math.round((count / totalAnswers) * 100)
                        : 0;
                    return (
                      <div className="answer-bar" key={index}>
                        <div className="answer-bar-label">
                          <span>
                            <strong>{String.fromCharCode(65 + index)}</strong> —{" "}
                            {option}
                          </span>
                          <span>{count}</span>
                        </div>
                        <div className="answer-bar-track">
                          <div
                            className={
                              "answer-bar-fill" +
                              (index === currentQuestion.correctIndex
                                ? " correct"
                                : "")
                            }
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="reports-section">
        <button
          type="button"
          className="reports-toggle"
          onClick={() => {
            if (!reportOpen) openReports();
            else setReportOpen(false);
          }}
        >
          <span className="reports-toggle-title">Reports</span>
          <span className="reports-toggle-caret" aria-hidden="true">
            {reportOpen ? "−" : "+"}
          </span>
        </button>
        {reportOpen && (
          <div className="admin-card report-panel">
            {reportError && <p className="error" role="alert">{reportError}</p>}

            {reportLoading ? (
              <div>
                <div className="skeleton skeleton-line" />
                <div className="skeleton skeleton-line" />
                <div className="skeleton skeleton-line" />
              </div>
            ) : sessions.length === 0 ? (
              <p className="field-hint">
                No sessions yet. Create and publish a session to see results
                here.
              </p>
            ) : (
              <div className="session-list">
                {sessions.map((s) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    onDownload={() => downloadSessionCsv(s)}
                    onOpen={() => selectSession(s.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title || ""}
        message={confirmDialog?.message}
        points={confirmDialog?.points}
        confirmLabel={confirmDialog?.confirmLabel}
        danger={confirm.kind === "delete" || confirm.kind === "endSession"}
        onConfirm={() => {
          if (confirm.kind === "delete") {
            removeQuestion(confirm.index);
            setConfirm({ kind: null, index: null });
            showToast("Question deleted.", "info");
          } else {
            confirmAction();
          }
        }}
        onCancel={() => setConfirm({ kind: null, index: null })}
      />
    </section>
  );
}
