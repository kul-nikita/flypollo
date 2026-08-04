const DEFAULT_ADMIN_EMAILS = [
  "kulnikita20@gmail.com",
  "pratima2k1@gmail.com",
];

const ADMIN_EMAILS =
  import.meta.env.VITE_ADMIN_EMAILS
    ?.split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean) ?? [];

const FINAL_ADMIN_EMAILS =
  ADMIN_EMAILS.length > 0 ? ADMIN_EMAILS : DEFAULT_ADMIN_EMAILS;

export function isAdminEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  return FINAL_ADMIN_EMAILS.includes(normalized);
}
