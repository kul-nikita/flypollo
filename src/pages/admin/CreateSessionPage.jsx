import { defaultSessionName } from "../../lib/session";
import { validationError } from "../../lib/useAdminStore";

const STEPPER = [
  { label: "Create" },
  { label: "Upload" },
  { label: "Review" },
];

export default function CreateSessionPage({ store, onNavigate }) {
  const {
    session,
    createForm,
    setCreateForm,
    creating,
    file,
    generating,
    questions,
    saving,
    step,
    normalizedStatus,
    sessions,
    createSession,
    handleFile,
    generate,
    updateQuestion,
    updateOption,
    addQuestion,
    startOver,
    saveDraft,
    selectSession,
    requestConfirm,
  } = store;

  const drafts = sessions.filter((s) => s.status === "draft");
  const stepState = (label) => {
    if (step === label) return "current";
    if (step === "review" && label === "Upload") return "done";
    if (label === "Create" && (step === "upload" || step === "review")) return "done";
    return "";
  };

  if (normalizedStatus !== "draft") {
    return (
      <div className="adb-page">
        <header className="adb-page-head">
          <h1 className="adb-page-title">Create Session</h1>
          <p className="adb-page-sub">Turn a transcript into a live quiz.</p>
        </header>
        <div className="adb-card adb-empty">
          <p>
            "{session?.sessionName}" is already {normalizedStatus}. Manage it
            from the live console instead.
          </p>
          <div className="adb-card-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onNavigate("live")}
            >
              Open live console
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => store.newSession()}
            >
              Start a new session
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="adb-page">
      <header className="adb-page-head">
        <h1 className="adb-page-title">Create Session</h1>
        <p className="adb-page-sub">
          Name a session, upload a transcript, and let FlyPollo draft the
          questions.
        </p>
      </header>

      {session && (
        <ol className="stepper adb-stepper" aria-label="Create workflow">
          {STEPPER.map((item, index) => (
            <li
              key={item.label}
              className={stepState(item.label) === "current" ? "step-current" : stepState(item.label) === "done" ? "step-done" : ""}
            >
              <span className="step-num">{index + 1}</span>
              <span className="step-label">{item.label}</span>
            </li>
          ))}
        </ol>
      )}

      {step === "create" && (
        <div className="adb-card">
          <h2 className="adb-card-title">Create a session</h2>
          <p className="adb-page-sub">
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

          {drafts.length > 0 && (
            <div className="adb-drafts">
              <h3 className="adb-card-subtitle">Continue an existing draft</h3>
              <div className="adb-session-list">
                {drafts.map((s) => (
                  <div className="adb-session-item" key={s.id}>
                    <div className="adb-session-item-main">
                      <div className="adb-session-item-head">
                        <span className="adb-session-name">
                          {s.sessionName}
                        </span>
                      </div>
                      <p className="adb-session-meta">
                        {s.questionCount} questions drafted
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => selectSession(s.id)}
                    >
                      Edit
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {step === "upload" && (
        <div className="adb-card">
          <h2 className="adb-card-title">Upload a transcript</h2>
          <p className="adb-page-sub">
            {session?.sessionName ? `"${session.sessionName}" — ` : ""}
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
              <span className="dropzone-icon" aria-hidden="true">
                ↑
              </span>
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
              {generating
                ? "Generating questions…"
                : "Generate questions"}
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
              onClick={() => requestConfirm({ kind: "publish" })}
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
                  <span className="question-number">
                    Question {index + 1}
                  </span>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => requestConfirm({ kind: "delete", index })}
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
                          updateQuestion(index, {
                            correctIndex: optionIndex,
                          })
                        }
                        aria-label={`Mark option ${optionIndex + 1} as correct`}
                      />
                      <input
                        type="text"
                        value={option}
                        onChange={(event) =>
                          updateQuestion(index, {
                            options: q.options.map((opt, oi) =>
                              oi === optionIndex ? event.target.value : opt
                            ),
                          })
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
          <button
            type="button"
            className="btn btn-secondary"
            onClick={addQuestion}
          >
            + Add question
          </button>
        </>
      )}
    </div>
  );
}
