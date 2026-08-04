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
  newRoomCode,
  newSessionId,
  newSessionRecord,
  normalizeStatus,
  sessionDocId,
  sessionShareUrl,
} from "./session";
import {
  listSessions,
  sessionToCsv,
  csvFilename,
  deleteSession as deleteSessionFromDb,
} from "./report";
import { useToast } from "../components/Toasts";

export const FUNCTION_URL = "/.netlify/functions/generate-mcq";
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const DEFAULT_LIVE = { questionIndex: 0, status: "idle" };

export function emptyQuestion() {
  return { question: "", options: ["", "", "", ""], correctIndex: 0 };
}

export function validationError(questions) {
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

export function useAdminStore(adminEmail) {
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
  const { showToast } = useToast();

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
  const shareUrl =
    session?.shareUrl || (session?.roomCode ? sessionShareUrl(session.roomCode) : "");

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
    QRCode.toDataURL(shareUrl, {
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
  }, [session?.roomCode, normalizedStatus, shareUrl]);

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

  function selectSession(id) {
    const next = sessions.find((s) => s.id === id);
    if (!next) return;
    setSession(next);
    setQuestions(next.questions);
    setFile(null);
    setError("");
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
      const shareUrl = sessionShareUrl(roomCode);
      let qrDataUrl = "";
      try {
        qrDataUrl = await QRCode.toDataURL(shareUrl, {
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
          shareUrl,
          qrUrl: qrDataUrl,
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
              shareUrl,
              qrUrl: qrDataUrl,
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
      showToast(
        "Back to editing. Publish again to create a fresh room code.",
        "info"
      );
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setSaving(false);
      setConfirm({ kind: null, index: null });
    }
  }

  async function removeSession(id) {
    if (!configured || !db) {
      throw new Error(
        "Firebase is not configured. Add the VITE_FIREBASE_* variables to .env and restart."
      );
    }
    await deleteSessionFromDb(db, id);
    if (session?.id === id) newSession();
    await refreshSessions();
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
          : confirm.kind === "delete"
            ? {
                title: "Delete question?",
                message: "This question will be removed from the quiz.",
                confirmLabel: "Delete question",
              }
            : null;

  function runConfirm() {
    if (confirm.kind === "publish") publish();
    else if (confirm.kind === "backToDraft") backToDraft();
    else if (confirm.kind === "endSession") endSession();
    else if (confirm.kind === "delete") {
      if (typeof confirm.index === "number") {
        removeQuestion(confirm.index);
        showToast("Question deleted.", "info");
      }
      setConfirm({ kind: null, index: null });
    }
  }

  return {
    loading,
    sessions,
    session,
    createForm,
    setCreateForm,
    creating,
    file,
    generating,
    questions,
    live,
    connected,
    saving,
    error,
    qrDataUrl,
    answerCounts,
    participantCount,
    normalizedStatus,
    started,
    step,
    liveSessionId,
    shareUrl,
    currentQuestion,
    totalAnswers,
    refreshSessions,
    selectSession,
    newSession,
    createSession,
    handleFile,
    generate,
    updateQuestion,
    updateOption,
    removeQuestion,
    addQuestion,
    startOver,
    saveDraft,
    publish,
    startSession,
    endSession,
    backToDraft,
    removeSession,
    downloadSessionCsv,
    requestConfirm: setConfirm,
    confirm: confirm,
    confirmDialog,
    runConfirm,
  };
}
