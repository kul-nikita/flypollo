import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { ref, onValue } from "firebase/database";
import { db, database, configured } from "../firebase";
import { todayLocal, roomCodeFor } from "../lib/session";

const STORAGE_KEY = "flypollo.participant";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function loadSavedProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved.savedAt || !saved.participantId || !saved.email) return null;
    if (Date.now() - saved.savedAt > WEEK_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return saved;
  } catch {
    return null;
  }
}

function saveProfile(profile) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...profile, savedAt: Date.now() }));
}

function clearSavedProfile() {
  localStorage.removeItem(STORAGE_KEY);
}

function emailToDocId(email) {
  const bytes = new TextEncoder().encode(String(email).trim().toLowerCase());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function generateParticipantId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "p_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function toProfile(data) {
  return {
    participantId: data.participantId,
    name: data.name,
    email: data.email,
    institution: data.institution,
    designation: data.designation,
  };
}

async function registerParticipant({ name, email, institution, designation }) {
  const normalizedEmail = email.trim().toLowerCase();
  const refDoc = doc(db, "participants", emailToDocId(normalizedEmail));
  const snapshot = await getDoc(refDoc);
  if (snapshot.exists()) {
    return toProfile(snapshot.data());
  }
  const profile = {
    participantId: generateParticipantId(),
    name: name.trim(),
    email: normalizedEmail,
    institution: institution.trim(),
    designation: designation.trim(),
    createdAt: new Date().toISOString(),
  };
  await setDoc(refDoc, profile);
  return toProfile(profile);
}

function JoinBranding({ qrDataUrl, roomCode, joinUrl }) {
  return (
    <section className="join-brand">
      <div className="brand-left">
        <span className="brand-logo">FlyPollo</span>
        <p className="hint">Hospital training quiz</p>
      </div>
      <div className="brand-room">
        <span className="room-label">Room code</span>
        <span className="room-code">{roomCode}</span>
      </div>
      {qrDataUrl && (
        <div className="brand-qr">
          <img src={qrDataUrl} alt={`QR code for ${joinUrl}`} width={140} height={140} />
          <p className="hint">Scan to join</p>
        </div>
      )}
    </section>
  );
}

export default function Join() {
  const [status, setStatus] = useState("loading");
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", institution: "", designation: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [live, setLive] = useState({
    questionIndex: 0,
    status: "idle",
    sessionDate: todayLocal(),
  });
  const [questions, setQuestions] = useState([]);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [submittedAnswers, setSubmittedAnswers] = useState({});
  const [qrDataUrl, setQrDataUrl] = useState("");

  const sessionDate = todayLocal();
  const roomCode = roomCodeFor(sessionDate);
  const joinUrl = `${window.location.origin}/join`;
  const currentQuestion = questions[live.questionIndex] || null;

  useEffect(() => {
    const saved = loadSavedProfile();
    if (saved) {
      setProfile(saved);
      setStatus("live");
    } else {
      setStatus("form");
    }
  }, []);

  useEffect(() => {
    if (!configured || !database) return;
    const liveRef = ref(database, "session/live");
    const off = onValue(liveRef, (snap) => {
      const value = snap.val();
      if (value && typeof value.questionIndex === "number" && value.status) {
        setLive(value);
      } else {
        setLive({ questionIndex: 0, status: "idle", sessionDate: todayLocal() });
      }
    });
    return () => off();
  }, []);

  useEffect(() => {
    QRCode.toDataURL(joinUrl, {
      width: 280,
      margin: 1,
      color: { dark: "#14303a", light: "#ffffff" },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [joinUrl]);

  useEffect(() => {
    if (live.status !== "live" || !configured || !db) return;
    getDoc(doc(db, "sessions", live.sessionDate))
      .then((snap) => {
        if (snap.exists()) {
          setQuestions(snap.data().questions || []);
        } else {
          setQuestions([]);
        }
      })
      .catch(() => setQuestions([]));
  }, [live.status, live.sessionDate]);

  useEffect(() => {
    setSelectedAnswer(null);
    if (live.status !== "live" || !configured || !db || !profile) return;
    let cancelled = false;
    getDoc(
      doc(db, "sessions", live.sessionDate, "answers", String(live.questionIndex))
    )
      .then((snap) => {
        if (cancelled) return;
        const existing = snap.exists()
          ? snap.data()[profile.participantId]
          : null;
        if (existing && typeof existing.selectedIndex === "number") {
          setSubmittedAnswers((map) => ({
            ...map,
            [live.questionIndex]: existing.selectedIndex,
          }));
          setSelectedAnswer(existing.selectedIndex);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [live.questionIndex, live.status, live.sessionDate, profile]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (!configured || !db) {
        throw new Error(
          "Firebase is not configured. Add the VITE_FIREBASE_* variables to .env and restart."
        );
      }
      const participant = await registerParticipant(form);
      saveProfile(participant);
      setProfile(participant);
      setStatus("live");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function resetProfile() {
    clearSavedProfile();
    setProfile(null);
    setError("");
    setStatus("form");
  }

  async function handleAnswer(optionIndex) {
    if (!profile || live.status !== "live") return;
    const qIndex = live.questionIndex;
    if (submittedAnswers[qIndex] !== undefined || selectedAnswer !== null) return;
    setError("");
    setSelectedAnswer(optionIndex);
    try {
      await setDoc(
        doc(db, "sessions", live.sessionDate, "answers", String(qIndex)),
        {
          [profile.participantId]: {
            selectedIndex: optionIndex,
            timestamp: new Date().toISOString(),
          },
        },
        { merge: true }
      );
      setSubmittedAnswers((map) => ({ ...map, [qIndex]: optionIndex }));
    } catch (err) {
      setSelectedAnswer(null);
      setError(err.message);
    }
  }

  if (status === "loading") {
    return (
      <section className="panel">
        <p className="hint">Loading your profile…</p>
      </section>
    );
  }

  if (status === "form") {
    return (
      <>
        <JoinBranding qrDataUrl={qrDataUrl} roomCode={roomCode} joinUrl={joinUrl} />
        <section className="panel">
          <h1>Join a session</h1>
          <p className="hint">
            Tell us who you are so your quiz answers are saved to your profile.
          </p>
          <form onSubmit={handleSubmit} className="form">
            <label>
              Full name
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
                placeholder="e.g. Ada Lovelace"
              />
            </label>
            <label>
              Email
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => updateField("email", e.target.value)}
                placeholder="e.g. ada@hospital.org"
              />
            </label>
            <label>
              Institution
              <input
                type="text"
                required
                value={form.institution}
                onChange={(e) => updateField("institution", e.target.value)}
                placeholder="e.g. St. Mary's Hospital"
              />
            </label>
            <label>
              Designation
              <input
                type="text"
                required
                value={form.designation}
                onChange={(e) => updateField("designation", e.target.value)}
                placeholder="e.g. Staff Nurse"
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button type="submit" disabled={submitting}>
              {submitting ? "Registering…" : "Register"}
            </button>
          </form>
        </section>
      </>
    );
  }

  if (live.status === "idle") {
    return (
      <>
        <JoinBranding qrDataUrl={qrDataUrl} roomCode={roomCode} joinUrl={joinUrl} />
        <section className="panel">
          <h1>Waiting for session to start</h1>
          <p className="status-ok">
            You're registered. The question will appear here when the presenter
            starts the session.
          </p>
          <div className="profile-card">
            <p>
              <strong>{profile.name}</strong> — {profile.designation}
            </p>
            <p className="hint">
              {profile.email} · {profile.institution}
            </p>
          </div>
          <button type="button" className="secondary link-btn" onClick={resetProfile}>
            Use a different profile
          </button>
        </section>
      </>
    );
  }

  if (live.status === "ended") {
    return (
      <>
        <JoinBranding qrDataUrl={qrDataUrl} roomCode={roomCode} joinUrl={joinUrl} />
        <section className="panel">
          <h1>Session ended</h1>
          <p className="hint">
            Thanks for participating! Ask your trainer if you have any questions.
          </p>
          <button type="button" className="secondary link-btn" onClick={resetProfile}>
            Use a different profile
          </button>
        </section>
      </>
    );
  }

  if (!currentQuestion) {
    return (
      <section className="panel">
        <p className="hint">Loading question…</p>
      </section>
    );
  }

  const locked = submittedAnswers[live.questionIndex] !== undefined;

  return (
    <section className="panel quiz">
      <p className="quiz-room">
        Room <strong>{roomCode}</strong> · {profile.name}
      </p>
      <h1>{currentQuestion.question}</h1>
      {error && <p className="error">{error}</p>}
      <div className="answer-grid">
        {currentQuestion.options.map((option, index) => (
          <button
            key={index}
            type="button"
            className={selectedAnswer === index ? "answer-btn selected" : "answer-btn"}
            onClick={() => handleAnswer(index)}
            disabled={locked}
          >
            <span className="answer-letter">
              {String.fromCharCode(65 + index)}
            </span>
            {option}
          </button>
        ))}
      </div>
      {selectedAnswer !== null && (
        <p className="hint">
          {locked
            ? `Answer locked — you chose option ${String.fromCharCode(65 + selectedAnswer)}.`
            : `You selected option ${String.fromCharCode(65 + selectedAnswer)}.`}
        </p>
      )}
    </section>
  );
}
