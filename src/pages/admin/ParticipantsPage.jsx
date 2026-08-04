import { useEffect, useState } from "react";
import { configured, db } from "../../firebase";
import { listParticipantStats } from "../../lib/report";
import { useToast } from "../../components/Toasts";

export default function ParticipantsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const { showToast } = useToast();

  useEffect(() => {
    if (!configured || !db) {
      setError(
        "Firebase is not configured. Add the VITE_FIREBASE_* variables to .env and restart."
      );
      setLoading(false);
      return;
    }
    listParticipantStats(db)
      .then(setRows)
      .catch((err) => {
        setError(err.message);
        showToast(err.message, "error");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = rows.filter((row) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [row.name, row.email, row.institution, row.designation].some((value) =>
      String(value || "").toLowerCase().includes(q)
    );
  });

  function formatLastActive(timestamp) {
    if (!timestamp) return "—";
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString();
  }

  return (
    <div className="adb-page">
      <header className="adb-page-head">
        <h1 className="adb-page-title">Participants</h1>
        <p className="adb-page-sub">
          Everyone who has registered across your sessions.
        </p>
      </header>

      <section className="adb-card">
        <div className="adb-participants-toolbar">
          <input
            type="search"
            className="adb-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, email, institution or designation…"
            aria-label="Search participants"
          />
          <span className="adb-count">{filtered.length} shown</span>
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {loading ? (
          <div>
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line" />
          </div>
        ) : rows.length === 0 ? (
          <p className="field-hint">
            No participants yet. Share a session room code to get started.
          </p>
        ) : filtered.length === 0 ? (
          <p className="field-hint">No participants match your search.</p>
        ) : (
          <div className="results-table-wrap">
            <table className="results-table adb-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Institution</th>
                  <th>Designation</th>
                  <th>Sessions Joined</th>
                  <th>Last Active</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.participantId}>
                    <td>{row.name}</td>
                    <td>{row.email}</td>
                    <td>{row.institution || "—"}</td>
                    <td>{row.designation || "—"}</td>
                    <td>{row.sessionsJoined}</td>
                    <td>{formatLastActive(row.lastActive)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
