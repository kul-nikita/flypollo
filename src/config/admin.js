const ADMIN_EMAILS =
  import.meta.env.VITE_ADMIN_EMAILS
    ?.split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean) ?? [];

export function isAdminEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  return ADMIN_EMAILS.includes(normalized);
}
