import { useEffect, useMemo, useRef, useState } from "react";
import { configured, db } from "../../firebase";
import { useToast } from "../../components/Toasts";
import { formatDate } from "../../lib/session";
import { csvFilename, sessionToCsv } from "../../lib/report";
import {
  answersCsv,
  downloadTextFile,
  loadSessionAnalytics,
  participantsCsv,
  sessionAnalyticsJson,
  sessionPdfReport,
} from "../../lib/analytics";

const DIFFICULTY_CLASS = {
  Easy: "ana-easy",
  Medium: "ana-medium",
  Hard: "ana-hard",
};

function optionLetter(index) {
  return String.fromCharCode(65 + index);
}

function formatDuration(ms) {
  if (ms == null) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function StatCard({ label, value, mono = false }) {
  return (
    <div className="stat-card">
      <span className={`stat-value${mono ? " ana-mono" : ""}`}>{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function Bar({ label, value, width, tone }) {
  return (
    <div className="ana-bar-row">
      <span className="ana-bar-label">{label}</span>
      <div className="ana-bar-track">
        <div
          className={`ana-bar-fill${tone ? ` ana-bar-${tone}` : ""}`}
          style={{ width: `${Math.min(100, Math.max(0, width))}%` }}
        />
      </div>
      <span className="ana-bar-value">{value}</span>
    </div>
  );
}

function ChartEmpty({ message }) {
  return <p className="ana-chart-empty">{message}</p>;
}

export default function AnalyticsPage({ sessionId, onBack }) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const downloadLockRef = useRef(0);

  function handleExport(run) {
    const now = Date.now();
    if (now - downloadLockRef.current < 400) return;
    downloadLockRef.current = now;
    run();
  }

  useEffect(() => {
    let cancelled = false;
    if (!configured || !db) {
      setError(
        "Firebase is not configured. Add the VITE_FIREBASE_* variables to .env and restart."
      );
      setLoading(false);
      return;
    }
    if (!sessionId) {
      setError("Select a completed session to view its analytics.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    loadSessionAnalytics(db, sessionId)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          showToast(err.message, "error");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, showToast]);

  const leaderboard = useMemo(() => (data ? data.leaderboard : []), [data]);

  if (loading) {
    return (
      <div className="adb-page">
        <div className="skeleton skeleton-block" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="adb-page">
        <div className="adb-card adb-empty">
          <p>{error || "No analytics available."}</p>
          <button type="button" className="btn btn-primary" onClick={onBack}>
            Back to Session History
          </button>
        </div>
      </div>
    );
  }

  const { session, stats, questionStats } = data;
  const maxBucket = Math.max(1, ...stats.scoreDistribution.map((b) => b.count));
  const maxQuestionPct = Math.max(1, ...questionStats.map((q) => q.correctPct));
  const responseTimes = questionStats
    .map((q) => q.avgResponseMs)
    .filter((value) => value != null);
  const maxResponse = Math.max(1, ...responseTimes);

  const base =
    (session.sessionName || "session")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || session.id;

  const exportsList = [
    {
      key: "results",
      label: "Results CSV",
      run: () =>
        downloadTextFile(
          csvFilename({ sessionName: session.sessionName, id: session.id }),
          sessionToCsv({ rows: data.rows })
        ),
    },
    {
      key: "participants",
      label: "Participants CSV",
      run: () =>
        downloadTextFile(
          `flypollo-participants-${base}.csv`,
          participantsCsv(data.rows)
        ),
    },
    {
      key: "answers",
      label: "Answers CSV",
      run: () =>
        downloadTextFile(
          `flypollo-answers-${base}.csv`,
          answersCsv(data.questions, data.answers, data.rows)
        ),
    },
    {
      key: "json",
      label: "Analytics JSON",
      run: () =>
        downloadTextFile(
          `flypollo-analytics-${base}.json`,
          sessionAnalyticsJson(data),
          "application/json"
        ),
    },
    {
      key: "pdf",
      label: "PDF Report",
      disabled: true,
      run: () => {
        try {
          sessionPdfReport();
        } catch (err) {
          showToast(err.message, "info");
        }
      },
    },
  ];

  return (
    <div className="adb-page">
      <header className="adb-page-head">
        <div>
          <h1 className="adb-page-title">Session Analytics</h1>
          <p className="adb-page-sub">
            {session.sessionName} · {formatDate(session.sessionDate)}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onBack}
        >
          ← Back to History
        </button>
      </header>

      <section className="adb-card">
        <div className="adb-section-head">
          <h2 className="adb-card-title">Overview</h2>
        </div>
        <div className="stat-grid">
          <StatCard label="Session Name" value={session.sessionName} />
          <StatCard
            label="Date"
            value={formatDate(session.sessionDate) || "—"}
          />
          <StatCard label="Duration" value={formatDuration(data.durationMs)} />
          <StatCard label="Presenter" value={session.presenter || "—"} />
          <StatCard label="Participants" value={stats.joined} />
          <StatCard label="Completion" value={`${stats.completionRate}%`} />
          <StatCard label="Average Score" value={`${stats.avgScore}%`} />
          <StatCard label="Highest Score" value={`${stats.highestScore}%`} />
          <StatCard label="Lowest Score" value={`${stats.lowestScore}%`} />
          <StatCard label="Room Code" value={session.roomCode || "—"} mono />
          <StatCard label="Session ID" value={session.id} mono />
        </div>
      </section>

      <section className="adb-card">
        <div className="adb-section-head">
          <h2 className="adb-card-title">Charts</h2>
        </div>
        <div className="ana-charts">
          <div className="ana-chart">
            <h3 className="ana-chart-title">Score Distribution</h3>
            {stats.joined === 0 ? (
              <ChartEmpty message="No scores recorded yet." />
            ) : (
              <div className="ana-bars">
                {stats.scoreDistribution.map((bucket, index) => (
                  <Bar
                    key={bucket.label}
                    label={bucket.label}
                    value={bucket.count}
                    width={(bucket.count / maxBucket) * 100}
                    tone={
                      index >= 7
                        ? "good"
                        : index >= 4
                          ? "mid"
                          : "low"
                    }
                  />
                ))}
              </div>
            )}
          </div>

          <div className="ana-chart">
            <h3 className="ana-chart-title">Question-wise Correctness</h3>
            {stats.joined === 0 ? (
              <ChartEmpty message="No responses recorded yet." />
            ) : (
              <div className="ana-bars">
                {questionStats.map((q) => (
                  <Bar
                    key={q.index}
                    label={`Q${q.index + 1}`}
                    value={`${q.correctPct}%`}
                    width={(q.correctPct / maxQuestionPct) * 100}
                    tone={
                      q.correctPct >= 60
                        ? "good"
                        : q.correctPct >= 50
                          ? "mid"
                          : "low"
                    }
                  />
                ))}
              </div>
            )}
          </div>

          <div className="ana-chart">
            <h3 className="ana-chart-title">Average Response Time</h3>
            {stats.joined === 0 ? (
              <ChartEmpty message="No responses recorded yet." />
            ) : responseTimes.length === 0 ? (
              <ChartEmpty message="Response time is captured for sessions run with the latest build. It will appear here once participants answer a live quiz from the updated participant view." />
            ) : (
              <>
                <div className="ana-chart-summary">
                  Overall average:{" "}
                  <strong>{formatDuration(stats.avgResponseMs)}</strong> per
                  answer
                </div>
                <div className="ana-bars">
                  {questionStats.map((q) => (
                    <Bar
                      key={q.index}
                      label={`Q${q.index + 1}`}
                      value={
                        q.avgResponseMs != null
                          ? formatDuration(q.avgResponseMs)
                          : "—"
                      }
                      width={
                        q.avgResponseMs != null
                          ? (q.avgResponseMs / maxResponse) * 100
                          : 0
                      }
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="adb-card">
        <div className="adb-section-head">
          <h2 className="adb-card-title">Leaderboard</h2>
          <span className="adb-count">{leaderboard.length} ranked</span>
        </div>
        {leaderboard.length === 0 ? (
          <p className="field-hint">No participants answered yet.</p>
        ) : (
          <div className="results-table-wrap">
            <table className="results-table ana-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Name</th>
                  <th>Institution</th>
                  <th>Score</th>
                  <th>Correct Answers</th>
                  <th>Percentage</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((row) => (
                  <tr
                    key={row.participantId}
                    className={
                      row.rank <= 3 ? `ana-rank-${row.rank}` : ""
                    }
                  >
                    <td className="ana-rank">{row.rank}</td>
                    <td>
                      <strong>{row.name}</strong>
                    </td>
                    <td>{row.institution || "—"}</td>
                    <td>{row.scorePct}</td>
                    <td>
                      {row.correct}/{row.total}
                    </td>
                    <td>
                      <span
                        className={
                          row.scorePct >= 60 ? "score-good" : "score-low"
                        }
                      >
                        {row.scorePct}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="adb-card">
        <div className="adb-section-head">
          <h2 className="adb-card-title">Question Analysis</h2>
        </div>
        {questionStats.length === 0 ? (
          <p className="field-hint">No questions recorded for this session.</p>
        ) : (
          <div className="ana-question-list">
            {questionStats.map((q) => (
              <div className="ana-question" key={q.index}>
                <div className="ana-question-head">
                  <span className="ana-question-num">
                    Question {q.index + 1}
                  </span>
                  {q.difficulty && (
                    <span
                      className={`chip-difficulty ${DIFFICULTY_CLASS[q.difficulty]}`}
                    >
                      {q.difficulty}
                    </span>
                  )}
                </div>
                <h3 className="ana-question-text">{q.question}</h3>
                <p className="ana-correct-line">
                  Correct answer:{" "}
                  <strong>
                    {optionLetter(q.correctIndex)} —{" "}
                    {q.options[q.correctIndex] || "—"}
                  </strong>
                </p>
                <div className="ana-correct-metrics">
                  <span className="ana-metric ana-metric-good">
                    Correct {q.correctPct}%
                  </span>
                  <span className="ana-metric ana-metric-bad">
                    Incorrect {q.incorrectPct}%
                  </span>
                  <span className="ana-metric">
                    {q.answered} response{q.answered === 1 ? "" : "s"}
                  </span>
                  {q.avgResponseMs != null && (
                    <span className="ana-metric">
                      Avg time {formatDuration(q.avgResponseMs)}
                    </span>
                  )}
                </div>
                <div className="ana-distribution">
                  {q.options.map((option, optionIndex) => {
                    const count = q.counts[optionIndex] || 0;
                    const pct = q.answered
                      ? Math.round((count / q.answered) * 100)
                      : 0;
                    return (
                      <div className="answer-bar" key={optionIndex}>
                        <div className="answer-bar-label">
                          <span>
                            <strong>{optionLetter(optionIndex)}</strong> —{" "}
                            {option}
                          </span>
                          <span>
                            {count} · {pct}%
                          </span>
                        </div>
                        <div className="answer-bar-track">
                          <div
                            className={`answer-bar-fill${
                              optionIndex === q.correctIndex ? " correct" : ""
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="ana-wrong-hint">
                  Most chosen wrong answer:{" "}
                  {q.mostChosenWrong ? (
                    <strong>
                      {optionLetter(q.mostChosenWrong.optionIndex)} —{" "}
                      {q.mostChosenWrong.text} ({q.mostChosenWrong.count}{" "}
                      answer{q.mostChosenWrong.count === 1 ? "" : "s"})
                    </strong>
                  ) : (
                    "None"
                  )}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="adb-card">
        <div className="adb-section-head">
          <h2 className="adb-card-title">Downloads</h2>
        </div>
        <div className="ana-downloads">
          {exportsList.map((file) => (
            <button
              key={file.key}
              type="button"
              className="btn btn-secondary"
              disabled={file.disabled}
              title={
                file.disabled ? "PDF export is coming soon" : undefined
              }
              onClick={() => handleExport(file.run)}
            >
              {file.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
