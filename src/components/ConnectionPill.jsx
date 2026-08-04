export default function ConnectionPill({ connected }) {
  return (
    <span className={`status-pill ${connected ? "status-online" : "status-offline"}`}>
      <span className="status-dot" aria-hidden="true" />
      {connected ? "Connected" : "Offline"}
    </span>
  );
}
