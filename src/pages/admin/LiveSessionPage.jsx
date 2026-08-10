import { useEffect } from "react";
import StatusChip from "../../components/StatusChip";
import { formatDate } from "../../lib/session";
import { copyText } from "../../lib/copy";
import { useCountdown } from "../../lib/useCountdown";
import { useToast } from "../../components/Toasts";

function WordCloudList({ entries }) {
  const counts = {};
  for (const entry of Object.values(entries || {})) {
    if (!entry || typeof entry.text !== "string") continue;
    const word = entry.text.trim();
    if (!word) continue;
    counts[word] = (counts[word] || 0) + 1;
  }
  const words = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (words.length === 0) {
    return <p className="field-hint">Waiting for words to come in…</p>;
  }
  return (
    <ul className="wordcloud-list">
      {words.map(([word, count]) => (
        <li className="wordcloud-item" key={word}>
          <span className="wordcloud-word">{word}</span>
          <span className="wordcloud-count">{count}</span>
        </li>
      ))}
    </ul>
  );
}

export default function LiveSessionPage({ store, onNavigate }) {
  const {
    loading,
    session,
    questions,
    live,
    saving,
    qrDataUrl,
    answerCounts,
    currentAnswers,
    participantCount,
    currentQuestion,
    totalAnswers,
    normalizedStatus,
    shareUrl,
    navSaving,
    nextQuestion,
    prevQuestion,
    startSession,
    requestConfirm,
    reactions,
    clearReactions,
  } = store;
  const { showToast } = useToast();
  const remaining = useCountdown(
    currentQuestion?.timerSeconds ? live.questionShownAt : null,
    currentQuestion?.timerSeconds || 0
  );

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

  async function handleCopy(text, label) {
    const ok = await copyText(text);
    showToast(
      ok
        ? `${label} copied to clipboard.`
        : "Could not copy. Please copy manually.",
      ok ? "success" : "error"
    );
  }

  if (loading) {
    return (
      <div className="adb-page">
        <div className="skeleton skeleton-block" />
        <div className="skeleton skeleton-line" />
      </div>
    );
  }

  if (!session || !session.roomCode || !shareUrl) {
    return (
      <div className="adb-page">
        <header className="adb-page-head">
          <h1 className="adb-page-title">Live Session</h1>
          <p className="adb-page-sub">Control the room from here.</p>
        </header>
        <div className="adb-card adb-empty">
          <p>No published session to run yet.</p>
          <div className="adb-card-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onNavigate("create")}
            >
              Create a session
            </button>
          </div>
        </div>
      </div>
    );
  }

  const badgeClass =
    normalizedStatus === "live"
      ? "badge-live"
      : normalizedStatus === "completed"
        ? "badge-ended"
        : "badge-idle";
  const badgeLabel =
    normalizedStatus === "live"
      ? "● Live"
      : normalizedStatus === "completed"
        ? "Completed"
        : "Published";

  return (
    <div className="adb-page">
      <header className="adb-page-head">
        <div>
          <h1 className="adb-page-title">Live Session</h1>
          <p className="adb-page-sub">
            {session.sessionName} · {formatDate(session.sessionDate)}
          </p>
        </div>
        <StatusChip status={normalizedStatus} />
      </header>

      <div className="adb-live-grid">
        <section className="adb-card adb-live-room">
          <span className={`live-badge ${badgeClass}`}>{badgeLabel}</span>
          <h2 className="adb-room-label">Room code</h2>
          <p className="adb-room-code">{session.roomCode}</p>
          <div className="adb-room-buttons">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => handleCopy(shareUrl, "Share link")}
            >
              Copy Link
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => handleCopy(session.roomCode, "Room code")}
            >
              Copy Room Code
            </button>
          </div>
          <p className="adb-room-hint">
            Participants open the link or enter{" "}
            <strong>{session.roomCode}</strong> to join.
          </p>
          <div className="adb-room-stat">
            <span className="adb-room-stat-value">{participantCount}</span>
            <span className="adb-room-stat-label">
              participants answered
            </span>
          </div>
        </section>

        <section className="adb-card adb-live-qr">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={`QR code to open ${shareUrl}`}
              width={220}
              height={220}
            />
          ) : (
            <div className="skeleton skeleton-qr" />
          )}
          <p className="field-hint">Scan to join</p>
        </section>
      </div>

      <section className="adb-card">
        <div className="live-controls">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={prevQuestion}
            disabled={live.questionIndex <= 0 || navSaving}
          >
            {navSaving ? "…" : "← Prev"}
          </button>
          <span className="live-status">
            Question {live.questionIndex + 1} of {questions.length}
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={nextQuestion}
            disabled={live.questionIndex >= questions.length - 1 || navSaving}
          >
            {navSaving ? "…" : "Next →"}
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
              onClick={() => requestConfirm({ kind: "endSession" })}
              disabled={saving}
            >
              End session
            </button>
          )}
          {normalizedStatus === "completed" && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                onNavigate("analytics", { sessionId: session.id })
              }
            >
              View analytics
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => requestConfirm({ kind: "backToDraft" })}
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
            <h2 className="live-preview-question">
              {currentQuestion.question}
            </h2>
            {currentQuestion.timerSeconds > 0 && live.status === "live" && (
              <div
                className={`quiz-timer ${remaining <= 5 ? "quiz-timer-warn" : ""}`}
                role="timer"
                aria-label={`Time remaining: ${remaining} seconds`}
              >
                <span className="quiz-timer-value">{remaining}s</span>
              </div>
            )}
            <div className="live-answers">
              <h3 className="live-answers-title">
                Live answers ({totalAnswers})
              </h3>
              {currentQuestion.type === "wordcloud" ? (
                <WordCloudList entries={currentAnswers} />
              ) : (
                currentQuestion.options.map((option, index) => {
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
                })
              )}
            </div>
            {normalizedStatus === "live" && (
              <div className="live-reactions">
                <h3 className="live-answers-title">
                  Reactions ({Object.keys(reactions).length})
                </h3>
                {Object.keys(reactions).length === 0 ? (
                  <p className="field-hint">
                    Participants can tap the ⚡ button to react.
                  </p>
                ) : (
                  <div className="reaction-summary">
                    {Object.entries(
                      Object.values(reactions).reduce((acc, r) => {
                        if (!r || !r.emoji) return acc;
                        acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                        return acc;
                      }, {})
                    ).map(([emoji, count]) => (
                      <span className="reaction-chip" key={emoji}>
                        {emoji} {count}
                      </span>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={clearReactions}
                  disabled={Object.keys(reactions).length === 0}
                >
                  Clear reactions
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
