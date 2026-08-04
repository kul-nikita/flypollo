import { useEffect, useRef } from "react";

export default function ConfirmDialog({
  open,
  title,
  message,
  points,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
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
        onCancel?.();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="flypollo-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="flypollo-dialog-title">{title}</h2>
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
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmRef}
            className={danger ? "btn btn-danger" : "btn btn-primary"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
