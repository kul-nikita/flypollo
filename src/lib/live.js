import { ref, set } from "firebase/database";

export const DEFAULT_LIVE = { questionIndex: 0, status: "idle" };

export const LEGACY_LIVE_PATH = "session/live";

export function livePath(sessionId) {
  return `sessions/${sessionId}/live`;
}

export function liveRef(database, sessionId) {
  return ref(database, livePath(sessionId));
}

export async function writeLiveStates(database, sessionId, value) {
  if (!database || !sessionId) return;
  const perSession = set(ref(database, livePath(sessionId)), value);
  set(ref(database, LEGACY_LIVE_PATH), value).catch(() => {});
  await perSession;
}
