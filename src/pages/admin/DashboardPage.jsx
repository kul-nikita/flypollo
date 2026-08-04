import StatusChip from "../../components/StatusChip";
import { formatDate, todayLocal } from "../../lib/session";

function responsesFor(session) {
  if (!session || !Array.isArray(session.rows)) return 0;
  return session.rows.reduce((sum, row) => sum + (row.answered || 0), 0);
}

export default function DashboardPage({ store, onNavigate }) {
  const { sessions, loading } = store;
  const today = todayLocal();
  const todayList = sessions.filter((s) => s.sessionDate === today);
  const todaySession =
    todayList.find((s) => s.status === "live") ||
    todayList.find((s) => s.status === "published") ||
    todayList.find((s) => s.status === "completed") ||
    todayList.find((s) => s.status === "draft") ||
    null;
  const hasActive = sessions.some(
    (s) =>
      s.status === "published" ||
      s.status === "live" ||
      s.status === "completed"
  );
  const recent = sessions.slice(0, 5);

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
        <h1 className="adb-page-title">Dashboard</h1>
        <p className="adb-page-sub">
          Overview of your sessions and audience activity.
        </p>
      </header>

      <div className="adb-cards">
        <section className="adb-card adb-today-card">
          <h2 className="adb-card-title">Today's Session</h2>
          {todaySession ? (
            <>
              <div className="adb-today-top">
                <StatusChip status={todaySession.status} />
              </div>
              <h3 className="adb-today-name">{todaySession.sessionName}</h3>
              <p className="adb-today-meta">
                {formatDate(todaySession.sessionDate)}
                {todaySession.description
                  ? ` · ${todaySession.description}`
                  : ""}
              </p>
              {todaySession.roomCode ? (
                <p className="adb-today-room">
                  Room <strong>{todaySession.roomCode}</strong>
                </p>
              ) : (
                <p className="adb-today-room adb-today-none">
                  Not published yet
                </p>
              )}
              <div className="adb-stat-grid">
                <div className="stat-card">
                  <span className="stat-value">
                    {todaySession.participantCount}
                  </span>
                  <span className="stat-label">Participants</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">
                    {todaySession.questionCount}
                  </span>
                  <span className="stat-label">Questions</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">
                    {responsesFor(todaySession)}
                  </span>
                  <span className="stat-label">Responses</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">
                    {todaySession.status === "completed"
                      ? `${todaySession.avgScore}%`
                      : "—"}
                  </span>
                  <span className="stat-label">Avg score</span>
                </div>
              </div>
              <div className="adb-card-actions">
                {todaySession.status !== "draft" ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      store.selectSession(todaySession.id);
                      onNavigate("live");
                    }}
                  >
                    Open live console
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      store.selectSession(todaySession.id);
                      onNavigate("create");
                    }}
                  >
                    Continue editing
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="adb-empty">
              <p>No session scheduled for today yet.</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onNavigate("create")}
              >
                Create a session
              </button>
            </div>
          )}
        </section>

        <section className="adb-card adb-quick">
          <h2 className="adb-card-title">Quick actions</h2>
          <div className="adb-quick-list">
            <button
              type="button"
              className="adb-quick-item"
              onClick={() => onNavigate("create")}
            >
              <span className="adb-quick-icon" aria-hidden="true">
                ➕
              </span>
              <span>
                <strong>Create New Session</strong>
                <small>Upload a transcript to get started</small>
              </span>
            </button>
            <button
              type="button"
              className="adb-quick-item"
              disabled={!hasActive}
              onClick={() => onNavigate("live")}
            >
              <span className="adb-quick-icon" aria-hidden="true">
                📡
              </span>
              <span>
                <strong>Resume Live Session</strong>
                <small>Manage the room and questions</small>
              </span>
            </button>
            <button
              type="button"
              className="adb-quick-item"
              onClick={() => onNavigate("reports")}
            >
              <span className="adb-quick-icon" aria-hidden="true">
                📊
              </span>
              <span>
                <strong>Open Reports</strong>
                <small>Download results and summaries</small>
              </span>
            </button>
          </div>
        </section>
      </div>

      <section className="adb-card">
        <div className="adb-section-head">
          <h2 className="adb-card-title">Recent Sessions</h2>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onNavigate("history")}
          >
            View all
          </button>
        </div>
        {recent.length === 0 ? (
          <p className="field-hint">
            No sessions yet. Create your first session to get started.
          </p>
        ) : (
          <div className="adb-session-list">
            {recent.map((s) => (
              <div className="adb-session-item" key={s.id}>
                <div className="adb-session-item-main">
                  <div className="adb-session-item-head">
                    <span className="adb-session-name">{s.sessionName}</span>
                    <StatusChip status={s.status} />
                  </div>
                  <p className="adb-session-meta">
                    {formatDate(s.sessionDate)}
                    {s.roomCode ? ` · ${s.roomCode}` : ""}
                  </p>
                </div>
                <div className="adb-session-item-actions">
                  {s.status !== "draft" ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        store.selectSession(s.id);
                        onNavigate("live");
                      }}
                    >
                      Open
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        store.selectSession(s.id);
                        onNavigate("create");
                      }}
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
