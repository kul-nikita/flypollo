import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

const ToastContext = createContext(null);
let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
    clearTimeout(timers.current[id]);
    delete timers.current[id];
  }, []);

  const showToast = useCallback(
    (message, type = "success", timeout = 4500) => {
      const id = nextId++;
      setToasts((list) => [...list, { id, message, type }]);
      timers.current[id] = setTimeout(() => dismiss(id), timeout);
      return id;
    },
    [dismiss]
  );

  useEffect(
    () => () => {
      for (const timer of Object.values(timers.current)) clearTimeout(timer);
    },
    []
  );

  return (
    <ToastContext.Provider value={{ showToast, dismissToast: dismiss }}>
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast toast-${toast.type}`}
            role="status"
          >
            <span className="toast-icon" aria-hidden="true">
              {toast.type === "error" ? "!" : toast.type === "info" ? "i" : "✓"}
            </span>
            <span className="toast-message">{toast.message}</span>
            <button
              type="button"
              className="toast-close"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
