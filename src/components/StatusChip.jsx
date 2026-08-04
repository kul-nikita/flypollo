import { normalizeStatus } from "../lib/session";

export const STATUS_META = {
  draft: { label: "Draft", className: "chip-draft" },
  published: { label: "Published", className: "chip-published" },
  live: { label: "Live", className: "chip-live" },
  completed: { label: "Completed", className: "chip-completed" },
};

export default function StatusChip({ status }) {
  const meta = STATUS_META[normalizeStatus(status)] || STATUS_META.draft;
  return <span className={`status-chip ${meta.className}`}>{meta.label}</span>;
}
