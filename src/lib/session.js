export function todayLocal() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function formatDate(dateStr) {
  if (!dateStr) return "";
  const [year, month, day] = String(dateStr).split("-");
  if (!year || !month || !day) return dateStr;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function defaultSessionName() {
  return formatDate(todayLocal());
}

export function roomCodeFor(date) {
  let hash = 0;
  for (const char of date) {
    hash = (hash * 31 + char.charCodeAt(0)) % 1000000;
  }
  return `FP-${String(hash).padStart(6, "0")}`;
}

export function newSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "s_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function newRoomCode() {
  const number = Math.floor(100000 + Math.random() * 900000);
  return `FP-${number}`;
}

export const APP_URL = "https://flypollo.netlify.app";

export function sessionShareUrl(roomCode) {
  return `${APP_URL}?room=${encodeURIComponent(roomCode)}`;
}

export function sessionDocId(live) {
  if (live && typeof live.sessionId === "string" && live.sessionId) {
    return live.sessionId;
  }
  if (live && typeof live.sessionDate === "string" && live.sessionDate) {
    return live.sessionDate;
  }
  return null;
}

export function newSessionRecord({ sessionName, description, sessionDate }) {
  const now = new Date().toISOString();
  return {
    sessionName: String(sessionName || "").trim() || defaultSessionName(),
    description: String(description || "").trim(),
    sessionDate: sessionDate || todayLocal(),
    status: "draft",
    published: false,
    createdAt: now,
    updatedAt: now,
    publishedAt: "",
    publishedBy: "",
    presenter: "",
    transcriptFilename: "",
    roomCode: "",
    shareUrl: "",
    qrUrl: "",
    questionCount: 0,
    participantCount: 0,
    questions: [],
    analytics: {},
    draftId: "",
  };
}

export function normalizeStatus(status) {
  if (status === "ready") return "published";
  if (status === "ended") return "completed";
  if (typeof status !== "string" || !status) return "draft";
  return status;
}
