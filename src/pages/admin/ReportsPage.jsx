import { useRef, useState } from "react";
import { sessionsToCsv } from "../../lib/report";
import { formatDate } from "../../lib/session";

export default function ReportsPage({ store }) {
  const { sessions, loading, downloadSessionCsv } = store;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [generated, setGenerated] = useState(false);
  const [error, setError] = useState("");
  const downloadLockRef = useRef(0);

  const filtered = sessions.filter((s) => {
    const date = s.sessionDate || "";
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
  });

  function handleGenerate(event) {
    event.preventDefault();
    if (from && to && from > to) {
      setError("The 'From' date must be before the 'To' date.");
      return;
    }
    setError("");
    setGenerated(true);
  }

  function downloadSummary() {
    const now = Date.now();
    if (now - downloadLockRef.current < 400) return;
    downloadLockRef.current = now;
    const csv = sessionsToCsv(filtered);
    const blob = new Blob([`\uFEFF${csv}`], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "flypollo-results-summary.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <div className="adb-page">
        <div className="skeleton skeleton-block" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line" />
      </div>
    );
  }

  return (
    <div className="adb-page">
      <header className="adb-page-head">
        <h1 className="adb-page-title">Reports</h1>
        <p className="adb-page-sub">
          Session summaries and per-participant results, exportable to CSV.
        </p>
      </header>

      <section className="adb-card">
        <form className="report-controls" onSubmit={handleGenerate}>
          <label className="field">
            <span className="field-label">From</span>
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">To</span>
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-primary">
            Generate
          </button>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {generated && (
          <div>
            <div className="stat-grid">
              <div className="stat-card">
                <span className="stat-value">{filtered.length}</span>
                <span className="stat-label">Sessions</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">
                  {filtered.reduce((n, s) => n + s.participantCount, 0)}
                </span>
                <span className="stat-label">Total participants</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">
                  {filtered.length
                    ? Math.round(
                        filtered.reduce((n, s) => n + s.avgScore, 0) /
                          filtered.length
                      )
                    : 0}
                  %
                </span>
                <span className="stat-label">Average score</span>
              </div>
            </div>

            {filtered.length === 0 ? (
              <p className="field-hint">
                No sessions in this date range. Adjust the dates and generate
                again.
              </p>
            ) : (
              <div className="results-table-wrap">
                <table className="results-table">
                  <thead>
                    <tr>
                      <th>Session</th>
                      <th>Date</th>
                      <th>Status</th>
                      <th>Room</th>
                      <th>Questions</th>
                      <th>Participants</th>
                      <th>Avg Score</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((s) => (
                      <tr key={s.id}>
                        <td>{s.sessionName}</td>
                        <td>{formatDate(s.sessionDate)}</td>
                        <td>{s.status}</td>
                        <td>{s.roomCode || "—"}</td>
                        <td>{s.questionCount}</td>
                        <td>{s.participantCount}</td>
                        <td>{s.avgScore}%</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => downloadSessionCsv(s)}
                          >
                            Results CSV
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {filtered.length > 0 && (
              <div className="adb-card-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={downloadSummary}
                >
                  Download summary CSV
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
