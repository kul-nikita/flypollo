import { useEffect, useRef } from "react";

export default function ConfirmDialog({
  open,
  title,
  message,
  points,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  const confirmRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    function handleKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busy) onCancel?.();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onCancel, busy]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="flygamify-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="flygamify-dialog-title">{title}</h2>
        {message && <p className="modal-message">{message}</p>}
        {points && points.length > 0 && (
          <ul className="modal-points">
            {points.map((point) => (
              <li key={point}>
                <span className="modal-point-check" aria-hidden="true">✓</span>
                {point}
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmRef}
            className={danger ? "btn btn-danger" : "btn btn-primary"}
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {busy && <span className="spinner spinner-btn" aria-hidden="true" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
