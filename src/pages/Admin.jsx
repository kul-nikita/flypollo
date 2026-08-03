import { useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, onSnapshot, setDoc } from "firebase/firestore";
import { ref, onValue, set } from "firebase/database";
import { db, database, configured } from "../firebase";
import { todayLocal } from "../lib/session";
import { generateReport, toCsv } from "../lib/report";

const FUNCTION_URL = "/.netlify/functions/generate-mcq";
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function emptyQuestion() {
  return { question: "", options: ["", "", "", ""], correctIndex: 0 };
}

export default function Admin() {
  const [file, setFile] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [firestoreStatus, setFirestoreStatus] = useState("draft");
  const [loadingSession, setLoadingSession] = useState(true);
  const [live, setLive] = useState({
    questionIndex: 0,
    status: "idle",
    sessionDate: todayLocal(),
  });
  const [error, setError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [answerCounts, setAnswerCounts] = useState([0, 0, 0, 0]);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");
  const [reportData, setReportData] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");

  useEffect(() => {
    if (!configured || !db) {
      setLoadingSession(false);
      return;
    }
    getDoc(doc(db, "sessions", todayLocal()))
      .then((snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setQuestions(data.questions || []);
          setFirestoreStatus(data.status || "draft");
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingSession(false));

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

  const questionCount = questions.length;
  const isReady = firestoreStatus === "ready" && questionCount > 0;
  const currentQuestion = isReady
    ? questions[Math.min(Math.max(live.questionIndex, 0), questionCount - 1)]
    : null;
  const totalAnswers = answerCounts.reduce((sum, count) => sum + count, 0);

  function writeLive(patch) {
    if (!configured || !database) return;
    set(
      ref(database, "session/live"),
      {
        questionIndex: live.questionIndex,
        status: live.status,
        sessionDate: todayLocal(),
        ...patch,
      }
    ).catch((err) => setError(err.message));
  }

  function nextQuestion() {
    writeLive({
      questionIndex: Math.min(live.questionIndex + 1, questionCount - 1),
      status: "live",
    });
  }

  function prevQuestion() {
    writeLive({
      questionIndex: Math.max(live.questionIndex - 1, 0),
      status: "live",
    });
  }

  function startSession() {
    writeLive({ questionIndex: 0, status: "live" });
  }

  function endSession() {
    writeLive({ status: "ended" });
  }

  useEffect(() => {
    if (!isReady) return;
    function handleKey(event) {
      if (event.key === "ArrowRight") nextQuestion();
      if (event.key === "ArrowLeft") prevQuestion();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  useEffect(() => {
    if (!isReady || !configured || !db) return;
    const answersRef = doc(
      db,
      "sessions",
      live.sessionDate,
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
      (err) => setError(err.message)
    );
    return () => unsub();
  }, [isReady, live.sessionDate, live.questionIndex]);

  function handleFile(event) {
    const selected = event.target.files?.[0] || null;
    setFile(selected);
    setError("");
    setSaveMessage("");
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
    setSaveMessage("");
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
      setFirestoreStatus("draft");
    } catch (err) {
      setError(err.message);
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

  function reset() {
    setFile(null);
    setQuestions([]);
    setFirestoreStatus("draft");
    setError("");
    setSaveMessage("");
  }

  async function saveDraft() {
    setSaving(true);
    setError("");
    setSaveMessage("");
    try {
      if (!configured || !db) {
        throw new Error(
          "Firebase is not configured. Add the VITE_FIREBASE_* variables to .env and restart."
        );
      }
      if (questions.length === 0) {
        throw new Error("Add at least one question before saving.");
      }
      const invalid = questions.some(
        (q) =>
          !q.question.trim() ||
          q.options.length !== 4 ||
          q.options.some((option) => !option.trim())
      );
      if (invalid) {
        throw new Error("Every question needs text and 4 non-empty options.");
      }
      const date = todayLocal();
      const refDoc = doc(db, "sessions", date);
      await setDoc(refDoc, {
        status: "draft",
        questions,
        updatedAt: new Date().toISOString(),
      });
      setSaveMessage(`Draft set saved to sessions/${date} (status: draft).`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function markReady() {
    setSaving(true);
    setError("");
    setSaveMessage("");
    try {
      if (!configured || !db) {
        throw new Error(
          "Firebase is not configured. Add the VITE_FIREBASE_* variables to .env and restart."
        );
      }
      const date = todayLocal();
      await setDoc(
        doc(db, "sessions", date),
        {
          status: "ready",
          questions,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      setFirestoreStatus("ready");
      writeLive({ questionIndex: 0, status: "idle" });
      setSaveMessage(`Question set for ${date} is ready. Use the controls to go live.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function backToDraft() {
    setError("");
    try {
      await setDoc(
        doc(db, "sessions", todayLocal()),
        { status: "draft" },
        { merge: true }
      );
      setFirestoreStatus("draft");
    } catch (err) {
      setError(err.message);
    }
  }

  async function buildReport(resetRange) {
    setReportOpen(true);
    setReportLoading(true);
    setReportError("");
    try {
      if (!configured || !db) {
        throw new Error(
          "Firebase is not configured. Add the VITE_FIREBASE_* variables to .env and restart."
        );
      }
      let from = reportFrom;
      let to = reportTo;
      if (resetRange || !from || !to) {
        const sessionsSnap = await getDocs(collection(db, "sessions"));
        const dates = sessionsSnap.docs
          .map((doc) => doc.id)
          .filter((id) => /^\d{4}-\d{2}-\d{2}$/.test(id))
          .sort();
        const today = todayLocal();
        from = dates[0] || today;
        to = dates[dates.length - 1] || today;
        setReportFrom(from);
        setReportTo(to);
      }
      const data = await generateReport(db, from, to);
      setReportData(data);
    } catch (err) {
      setReportError(err.message);
    } finally {
      setReportLoading(false);
    }
  }

  function downloadReportCsv() {
    if (!reportData || !reportFrom || !reportTo) return;
    const csv = toCsv(reportData.days, reportData.rows);
    const filename = `flypollo-results-${reportFrom}-${reportTo}.csv`;
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  if (loadingSession) {
    return (
      <section className="panel">
        <p className="hint">Loading session…</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h1>Presenter console</h1>

      <div className="admin-toolbar report-toolbar">
        <button type="button" onClick={() => buildReport(false)}>
          Generate report
        </button>
      </div>

      {questions.length === 0 && (
        <form onSubmit={generate} className="upload-form">
          <label className="file-field">
            Transcript (.txt)
            <input
              type="file"
              accept=".txt,text/plain"
              onChange={handleFile}
              aria-label="Transcript file"
            />
          </label>
          {file && <p className="hint">Selected: {file.name}</p>}
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={!file || generating}>
            {generating ? "Generating 10 questions…" : "Generate 10 questions"}
          </button>
        </form>
      )}

      {questions.length > 0 && !isReady && (
        <>
          <div className="admin-toolbar">
            <button type="button" onClick={saveDraft} disabled={saving}>
              {saving ? "Saving…" : "Save as draft set"}
            </button>
            <button
              type="button"
              onClick={markReady}
              disabled={saving || questions.some(
                (q) =>
                  !q.question.trim() ||
                  q.options.length !== 4 ||
                  q.options.some((option) => !option.trim())
              )}
            >
              Mark ready
            </button>
            <button type="button" className="secondary" onClick={reset}>
              Start over
            </button>
          </div>
          {error && <p className="error">{error}</p>}
          {saveMessage && <p className="status-ok">{saveMessage}</p>}

          <div className="question-list">
            {questions.map((q, index) => (
              <div className="question-card editable" key={index}>
                <div className="question-head">
                  <span className="question-number">Q{index + 1}</span>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => removeQuestion(index)}
                  >
                    Delete
                  </button>
                </div>
                <textarea
                  value={q.question}
                  onChange={(e) =>
                    updateQuestion(index, { question: e.target.value })
                  }
                  rows={2}
                  aria-label={`Question ${index + 1}`}
                />
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
                        aria-label={`Mark option ${optionIndex + 1} correct`}
                      />
                      <input
                        type="text"
                        value={option}
                        onChange={(e) =>
                          updateOption(index, optionIndex, e.target.value)
                        }
                        aria-label={`Option ${optionIndex + 1}`}
                        placeholder={`Option ${optionIndex + 1}`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="secondary add-btn" onClick={addQuestion}>
            Add question
          </button>
        </>
      )}

      {isReady && (
        <div className="live-panel">
          <div className="live-controls">
            <button type="button" onClick={prevQuestion}>
              ← Prev
            </button>
            <span className="live-status">
              Status: {live.status} · Q{live.questionIndex + 1} of {questionCount}
            </span>
            <button type="button" onClick={nextQuestion}>
              Next →
            </button>
          </div>
          <div className="live-actions">
            {live.status !== "live" && (
              <button type="button" onClick={startSession}>
                Start session
              </button>
            )}
            {live.status !== "ended" && (
              <button type="button" className="danger" onClick={endSession}>
                End session
              </button>
            )}
            <button type="button" className="secondary" onClick={backToDraft}>
              Back to editing
            </button>
          </div>
          {error && <p className="error">{error}</p>}
          <p className="hint">
            Use the ← / → arrow keys to move between questions.
          </p>

          {currentQuestion && (
            <div className="question-card live-preview">
              <h2>{currentQuestion.question}</h2>
              <ol className="options">
                {currentQuestion.options.map((option, index) => (
                  <li
                    key={index}
                    className={index === currentQuestion.correctIndex ? "correct" : ""}
                  >
                    {option}
                  </li>
                ))}
              </ol>
              <div className="live-answers">
                <h3>Live answers ({totalAnswers})</h3>
                {currentQuestion.options.map((option, index) => {
                  const count = answerCounts[index] || 0;
                  const pct = totalAnswers > 0 ? Math.round((count / totalAnswers) * 100) : 0;
                  return (
                    <div className="answer-bar" key={index}>
                      <div className="answer-bar-label">
                        <span>
                          {String.fromCharCode(65 + index)} — {option}
                        </span>
                        <span>{count}</span>
                      </div>
                      <div className="answer-bar-track">
                        <div
                          className={
                            "answer-bar-fill" +
                            (index === currentQuestion.correctIndex ? " correct" : "")
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
      )}

      {reportOpen && (
        <div className="report-panel">
          <h2>FlyPollo — Session Results</h2>
          <div className="report-controls">
            <label>
              From
              <input
                type="date"
                value={reportFrom}
                onChange={(e) => setReportFrom(e.target.value)}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={reportTo}
                onChange={(e) => setReportTo(e.target.value)}
              />
            </label>
            <button
              type="button"
              onClick={() => buildReport(false)}
              disabled={reportLoading}
            >
              {reportLoading ? "Loading…" : "Generate"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => buildReport(true)}
              disabled={reportLoading}
            >
              Event range
            </button>
            {reportData && (
              <button type="button" className="secondary" onClick={downloadReportCsv}>
                Download CSV
              </button>
            )}
          </div>
          {reportError && <p className="error">{reportError}</p>}
          {reportData && (
            <div className="results-table-wrap">
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Institution</th>
                    <th>Designation</th>
                    {reportData.days.map((day) => (
                      <th key={day}>Score {day}</th>
                    ))}
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {reportData.rows.map((row) => (
                    <tr key={row.participantId}>
                      <td>{row.name}</td>
                      <td>{row.email}</td>
                      <td>{row.institution}</td>
                      <td>{row.designation}</td>
                      {reportData.days.map((day) => (
                        <td key={day}>{row.scores[day] || 0}</td>
                      ))}
                      <td>
                        <strong>{row.total}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
