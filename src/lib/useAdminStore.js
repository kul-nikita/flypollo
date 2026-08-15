import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
} from "firebase/firestore";
import { ref, onValue, get, set } from "firebase/database";
import { db, database, configured } from "../firebase";
import {
  todayLocal,
  newRoomCode,
  newSessionId,
  newSessionRecord,
  normalizeStatus,
  sessionShareUrl,
} from "./session";
import { DEFAULT_LIVE, liveRef, writeLiveStates } from "./live";
import {
  listSessions,
  sessionToCsv,
  csvFilename,
  deleteSession as deleteSessionFromDb,
  readAnswersByQuestion,
} from "./report";
import { useToast } from "../components/Toasts";

import {
  DEFAULT_TIMER_SECONDS,
  emptyQuestion,
  normalizeQuestion,
  validationError,
} from "./questions";

export const FUNCTION_URL = "/.netlify/functions/generate-mcq";
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export { DEFAULT_LIVE };
export {
  QUESTION_TYPES,
  DEFAULT_TIMER_SECONDS,
  emptyQuestion,
  normalizeQuestion,
  normalizeQuestions,
  validationError,
} from "./questions";

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
  const [questionCount, setQuestionCount] = useState(10);
  const [defaultTimerSeconds, setDefaultTimerSeconds] = useState(DEFAULT_TIMER_SECONDS);
  const [generating, setGenerating] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [live, setLive] = useState(DEFAULT_LIVE);
  const [connected, setConnected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [currentAnswers, setCurrentAnswers] = useState({});
  const [participantCount, setParticipantCount] = useState(0);
  const [reactions, setReactions] = useState({});
  const [confirm, setConfirm] = useState({ kind: null, index: null });
  const [recoveredLiveId, setRecoveredLiveId] = useState(null);
  const [navSaving, setNavSaving] = useState(false);
  const createLockRef = useRef(false);
  const generateLockRef = useRef(false);
  const saveLockRef = useRef(false);
  const publishLockRef = useRef(false);
  const startLockRef = useRef(false);
  const endLockRef = useRef(false);
  const backLockRef = useRef(false);
  const removeLockRef = useRef(false);
  const duplicateLockRef = useRef(false);
  const navLockRef = useRef(false);
  const navTargetRef = useRef(0);
  const csvLockRef = useRef(0);
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
  const liveSessionId = session?.id || null;
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
    let cancelled = false;
    listSessions(db)
      .then(async (list) => {
        if (cancelled) return;
        setSessions(list);
        const liveCandidate = list.find((s) => s.status === "live") || null;
        if (liveCandidate && configured && database) {
          const snap = await get(liveRef(database, liveCandidate.id));
          const value = snap.val();
          if (!cancelled && value && typeof value.status === "string") {
            if (value.status === "live") {
              setSession(liveCandidate);
              setQuestions((liveCandidate.questions || []).map(normalizeQuestion));
              setRecoveredLiveId(liveCandidate.id);
              return;
            }
          }
        }
        const current =
          list.find((s) => s.status === "draft" && s.questions.length > 0) ||
          list[0];
        if (current) {
          setSession(current);
          setQuestions((current.questions || []).map(normalizeQuestion));
        }
      })
      .catch((err) => {
        setError(err.message);
        showToast(err.message, "error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!configured || !database) return;
    const connectedRef = ref(database, ".info/connected");
    const offConnected = onValue(connectedRef, (snap) => {
      setConnected(Boolean(snap.val()));
    });
    return () => {
      offConnected();
    };
  }, []);

  useEffect(() => {
    if (!configured || !database || !session?.id) {
      setLive(DEFAULT_LIVE);
      return;
    }
    const offLive = onValue(liveRef(database, session.id), (snap) => {
      const value = snap.val();
      if (value && typeof value.status === "string") {
        setLive(value);
        if (typeof value.questionIndex === "number") {
          navTargetRef.current = value.questionIndex;
        }
      } else {
        setLive(DEFAULT_LIVE);
        navTargetRef.current = 0;
      }
    });
    return () => offLive();
  }, [session?.id]);

  useEffect(() => {
    if (!session?.roomCode || normalizedStatus === "draft") {
      setQrDataUrl("");
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(shareUrl, {
      width: 240,
      margin: 1,
      color: { dark: "#111111", light: "#ffffff" },
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
        setCurrentAnswers(snap.data() || {});
      },
      (err) => {
        setError(err.message);
        showToast(err.message, "error");
      }
    );
    return () => unsub();
  }, [liveSessionId, live.questionIndex, normalizedStatus, showToast]);

  useEffect(() => {
    if (!configured || !database || !session?.id || normalizedStatus === "draft") {
      setReactions({});
      return undefined;
    }
    const reactionsRef = ref(database, `sessions/${session.id}/reactions`);
    const offReactions = onValue(reactionsRef, (snap) => {
      setReactions(snap.val() || {});
    });
    return () => offReactions();
  }, [session?.id, normalizedStatus]);

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
  const totalAnswers = Object.values(currentAnswers).filter(
    (entry) =>
      entry &&
      (Number.isInteger(entry.selectedIndex) ||
        (typeof entry.text === "string" && entry.text.trim()))
  ).length;
  const answerCounts = Object.values(currentAnswers).reduce((counts, entry) => {
    if (entry && Number.isInteger(entry.selectedIndex)) {
      counts[entry.selectedIndex] = (counts[entry.selectedIndex] || 0) + 1;
    }
    return counts;
  }, []);

  function writeLive(patch) {
    if (!configured || !database || !session?.id) return Promise.resolve(false);
    return writeLiveStates(database, session.id, {
      questionIndex: live.questionIndex,
      status: live.status,
      sessionId: session.id,
      sessionDate: session.sessionDate || todayLocal(),
      roomCode: session.roomCode || null,
      ...patch,
    }).then(
      () => true,
      (err) => {
        setError(err.message);
        showToast(err.message, "error");
        return false;
      }
    );
  }

  function nextQuestion() {
    if (navLockRef.current) return;
    const currentIndex = navTargetRef.current;
    const nextIndex = Math.min(currentIndex + 1, questions.length - 1);
    navLockRef.current = true;
    navTargetRef.current = nextIndex;
    setNavSaving(true);
    writeLive({
      questionIndex: nextIndex,
      status: "live",
      questionShownAt: Date.now(),
    }).then((ok) => {
      if (!ok) navTargetRef.current = currentIndex;
    }).finally(() => {
      navLockRef.current = false;
      setNavSaving(false);
    });
  }

  function prevQuestion() {
    if (navLockRef.current) return;
    const currentIndex = navTargetRef.current;
    const prevIndex = Math.max(currentIndex - 1, 0);
    navLockRef.current = true;
    navTargetRef.current = prevIndex;
    setNavSaving(true);
    writeLive({
      questionIndex: prevIndex,
      status: "live",
      questionShownAt: Date.now(),
    }).then((ok) => {
      if (!ok) navTargetRef.current = currentIndex;
    }).finally(() => {
      navLockRef.current = false;
      setNavSaving(false);
    });
  }

  function selectSession(id) {
    const next = sessions.find((s) => s.id === id);
    if (!next) return;
    setSession(next);
    setQuestions((next.questions || []).map(normalizeQuestion));
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
    if (createLockRef.current) return;
    createLockRef.current = true;
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
      createLockRef.current = false;
    }
  }

  function handleFile(event) {
    setFile(event.target.files?.[0] || null);
    setError("");
  }

  async function generate(event) {
    event.preventDefault();
    if (generateLockRef.current) return;
    if (!file) return;
    if (!/\.txt$/i.test(file.name)) {
      setError("Please choose a .txt file.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("File is too large. Please use a transcript under 2 MB.");
      return;
    }
    generateLockRef.current = true;
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
        body: JSON.stringify({ transcript, count: questionCount }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      setQuestions(
        (data.questions || []).map((q) => ({
          ...normalizeQuestion(q),
          timerSeconds: defaultTimerSeconds,
        }))
      );
      showToast(
        `${data.questions?.length || 0} questions generated. Review them below.`,
        "success"
      );
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setGenerating(false);
      generateLockRef.current = false;
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

  function addQuestion(type = "mcq") {
    setQuestions((items) => [
      ...items,
      { ...emptyQuestion(type), timerSeconds: defaultTimerSeconds },
    ]);
  }

  function setDefaultTimer(value) {
    const timerSeconds = Math.min(300, Math.max(0, Number(value) || 0));
    setDefaultTimerSeconds(timerSeconds);
    setQuestions((items) =>
      items.map((item) => ({ ...item, timerSeconds }))
    );
  }

  function updateQuestionTimer(index, value) {
    const timerSeconds = Math.min(300, Math.max(0, Number(value) || 0));
    setQuestions((items) =>
      items.map((item, i) => {
        if (item.type === "mcq") return { ...item, timerSeconds };
        if (i === index) return { ...item, timerSeconds };
        return item;
      })
    );
  }

  function setQuestionType(index, type) {
    setQuestions((items) =>
      items.map((item, i) => (i === index ? emptyQuestion(type) : item))
    );
  }

  function addPollOption(index) {
    setQuestions((items) =>
      items.map((item, i) =>
        i === index
          ? { ...item, options: [...item.options, ""] }
          : item
      )
    );
  }

  function removePollOption(index, optionIndex) {
    setQuestions((items) =>
      items.map((item, i) => {
        if (i !== index || item.options.length <= 2) return item;
        return {
          ...item,
          options: item.options.filter((_, oi) => oi !== optionIndex),
        };
      })
    );
  }

  function startOver() {
    setFile(null);
    setQuestions([]);
    setError("");
  }

  async function saveDraft() {
    if (saveLockRef.current) return;
    const invalid = validationError(questions);
    if (invalid) {
      setError(invalid);
      showToast(invalid, "error");
      return;
    }
    saveLockRef.current = true;
    setSaving(true);
    setError("");
    try {
      if (!configured || !db || !session?.id) {
        throw new Error("Select a session before saving a draft.");
      }
      const questionCount = questions.length;
      const transcriptFilename = file?.name || session.transcriptFilename || "";
      await setDoc(
        doc(db, "sessions", session.id),
        {
          status: "draft",
          questions,
          questionCount,
          transcriptFilename,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      setSession((s) =>
        s
          ? {
              ...s,
              status: "draft",
              questions,
              questionCount,
              transcriptFilename,
            }
          : s
      );
      showToast("Draft saved. You can publish it any time.", "success");
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setSaving(false);
      saveLockRef.current = false;
    }
  }

  async function publish() {
    if (publishLockRef.current) return;
    const invalid = validationError(questions);
    if (invalid) {
      setError(invalid);
      showToast(invalid, "error");
      return;
    }
    publishLockRef.current = true;
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
          color: { dark: "#111111", light: "#ffffff" },
        });
      } catch {
        qrDataUrl = "";
      }
      const publishedId = newSessionId();
      const publishedRecord = {
        sessionId: publishedId,
        sessionName: session.sessionName,
        description: session.description || "",
        sessionDate: session.sessionDate,
        status: "published",
        published: true,
        createdAt: session.createdAt || publishedAt,
        updatedAt: publishedAt,
        publishedAt,
        publishedBy: adminEmail,
        presenter: adminEmail,
        transcriptFilename: file?.name || session.transcriptFilename || "",
        roomCode,
        shareUrl,
        qrUrl: qrDataUrl,
        questionCount: questions.length,
        participantCount: 0,
        questions,
        analytics: {},
        draftId: session.id,
      };
      await setDoc(doc(db, "sessions", publishedId), publishedRecord);
      setSession({ id: publishedId, ...publishedRecord });
      setQrDataUrl(qrDataUrl);
      await writeLiveStates(database, publishedId, {
        questionIndex: 0,
        status: "idle",
        sessionId: publishedId,
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
      publishLockRef.current = false;
      setConfirm({ kind: null, index: null });
    }
  }

  async function startSession() {
    if (startLockRef.current) return;
    startLockRef.current = true;
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
      writeLive({ questionIndex: 0, status: "live", questionShownAt: Date.now() });
      showToast("Quiz is live.", "success");
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setSaving(false);
      startLockRef.current = false;
    }
  }

  async function endSession() {
    if (endLockRef.current) return;
    endLockRef.current = true;
    setSaving(true);
    setError("");
    try {
      if (configured && db && session?.id) {
        const answers = await readAnswersByQuestion(db, session.id);
        const participantIds = new Set();
        let totalAnswers = 0;
        const perQuestion = {};
        for (const [questionIndex, data] of answers) {
          const question = questions[Number(questionIndex)];
          const optionCount = Array.isArray(question?.options)
            ? question.options.length
            : 4;
          const counts = new Array(Math.max(0, optionCount)).fill(0);
          for (const [participantId, entry] of Object.entries(data || {})) {
            if (!entry) continue;
            if (Number.isInteger(entry.selectedIndex)) {
              participantIds.add(participantId);
              totalAnswers += 1;
              if (
                entry.selectedIndex >= 0 &&
                entry.selectedIndex < counts.length
              ) {
                counts[entry.selectedIndex] += 1;
              }
            } else if (typeof entry.text === "string" && entry.text.trim()) {
              participantIds.add(participantId);
              totalAnswers += 1;
            }
          }
          perQuestion[questionIndex] = counts;
        }
        const analytics = {
          participantCount: participantIds.size,
          totalAnswers,
          questionCount: session.questionCount || questions.length,
          perQuestion,
          computedAt: new Date().toISOString(),
        };
        await setDoc(
          doc(db, "sessions", session.id),
          {
            status: "completed",
            participantCount: participantIds.size,
            analytics,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        setSession((s) =>
          s
            ? { ...s, status: "completed", participantCount: participantIds.size }
            : s
        );
      }
      writeLive({ status: "ended" });
      if (configured && db) {
        refreshSessions();
      }
      showToast(
        "Session completed. Results are available in Reports.",
        "success"
      );
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setSaving(false);
      endLockRef.current = false;
      setConfirm({ kind: null, index: null });
    }
  }

  async function backToDraft() {
    if (backLockRef.current) return;
    backLockRef.current = true;
    setSaving(true);
    setError("");
    try {
      const endedSessionId = session?.id || null;
      const endedSessionDate = session?.sessionDate || todayLocal();
      const endedRoomCode = session?.roomCode || null;
      const draftId = session?.draftId || "";
      let draft = null;
      if (configured && db && draftId) {
        draft = sessions.find((s) => s.id === draftId) || null;
        if (!draft) {
          const record = newSessionRecord({
            sessionName: session?.sessionName || "",
            description: session?.description || "",
            sessionDate: session?.sessionDate || todayLocal(),
          });
          draft = {
            id: draftId,
            ...record,
            transcriptFilename: session?.transcriptFilename || "",
            questionCount: questions.length,
            questions,
          };
          await setDoc(doc(db, "sessions", draftId), {
            sessionId: draftId,
            ...record,
            transcriptFilename: draft.transcriptFilename,
            questionCount: draft.questionCount,
            questions,
          });
        }
      }
      if (draft) {
        setSession(draft);
        setQuestions((draft.questions || []).map(normalizeQuestion));
      }
      if (configured && database && endedSessionId) {
        await writeLiveStates(database, endedSessionId, {
          questionIndex: 0,
          status: "idle",
          sessionId: endedSessionId,
          sessionDate: endedSessionDate,
          roomCode: endedRoomCode,
        });
      }
      setLive(DEFAULT_LIVE);
      showToast(
        "Back to editing. The published session stays on record; publishing again creates a fresh room code.",
        "info"
      );
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setSaving(false);
      backLockRef.current = false;
      setConfirm({ kind: null, index: null });
    }
  }

  async function removeSession(id) {
    if (removeLockRef.current) return;
    removeLockRef.current = true;
    try {
      if (!configured || !db) {
        throw new Error(
          "Firebase is not configured. Add the VITE_FIREBASE_* variables to .env and restart."
        );
      }
      await deleteSessionFromDb(db, id);
      if (session?.id === id) newSession();
      await refreshSessions();
    } finally {
      removeLockRef.current = false;
    }
  }

  async function duplicateSession(id) {
    if (duplicateLockRef.current) return null;
    duplicateLockRef.current = true;
    try {
      if (!configured || !db) {
        throw new Error(
          "Firebase is not configured. Add the VITE_FIREBASE_* variables to .env and restart."
        );
      }
      const source = sessions.find((s) => s.id === id);
      if (!source) throw new Error("Session not found.");
      const sessionId = newSessionId();
      const record = newSessionRecord({
        sessionName: `${source.sessionName} (copy)`,
        description: source.description || "",
        sessionDate: source.sessionDate || todayLocal(),
      });
      const duplicate = {
        ...record,
        questionCount: source.questionCount,
        questions: source.questions || [],
      };
      await setDoc(doc(db, "sessions", sessionId), { sessionId, ...duplicate });
      await refreshSessions();
      showToast(`Duplicate created: "${duplicate.sessionName}".`, "success");
      return sessionId;
    } finally {
      duplicateLockRef.current = false;
    }
  }

  function clearReactions() {
    if (!configured || !database || !session?.id) return;
    set(ref(database, `sessions/${session.id}/reactions`), null).catch(() => {});
  }

  function downloadSessionCsv(sessionToDownload) {
    const now = Date.now();
    if (now - csvLockRef.current < 400) return;
    csvLockRef.current = now;
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
            "A brand-new room code and QR will be generated",
            "A new published session record will be created",
            "Participants will immediately be able to join",
            "Previous published sessions are kept on record",
          ],
          confirmLabel: "Publish",
        }
      : confirm.kind === "backToDraft"
        ? {
            title: "Return to editing?",
            message:
              "This published session stays on record. You'll return to the editable draft, and publishing again creates a fresh room code.",
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
    questionCount,
    setQuestionCount,
    defaultTimerSeconds,
    setDefaultTimer,
    updateQuestionTimer,
    generating,
    questions,
    live,
    connected,
    saving,
    error,
    qrDataUrl,
    currentAnswers,
    participantCount,
    reactions,
    clearReactions,
    normalizedStatus,
    started,
    step,
    liveSessionId,
    shareUrl,
    currentQuestion,
    totalAnswers,
    answerCounts,
    recoveredLiveId,
    navSaving,
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
    setQuestionType,
    addPollOption,
    removePollOption,
    startOver,
    saveDraft,
    publish,
    startSession,
    endSession,
    backToDraft,
    nextQuestion,
    prevQuestion,
    removeSession,
    duplicateSession,
    downloadSessionCsv,
    requestConfirm: setConfirm,
    confirm: confirm,
    confirmDialog,
    runConfirm,
  };
}
