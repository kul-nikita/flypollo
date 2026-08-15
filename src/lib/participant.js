import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import { normalizeStatus } from "./session";

const STORAGE_KEY = "flygamify.participant";
const JOINED_SESSION_KEY = "flygamify.joinedSession";
const ADMIN_EMAIL_KEY = "flygamify.adminEmail";
const LEGACY_STORAGE_KEY = "flypollo.participant";
const LEGACY_JOINED_SESSION_KEY = "flypollo.joinedSession";
const LEGACY_ADMIN_EMAIL_KEY = "flypollo.adminEmail";
export function loadSavedProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved.savedAt || !saved.participantId || !saved.email) return null;
    return saved;
  } catch {
    return null;
  }
}

export function saveProfile(profile) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...profile, savedAt: Date.now() })
  );
}

export function clearSavedProfile() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

export function saveAdminEmail(email) {
  localStorage.setItem(ADMIN_EMAIL_KEY, String(email).trim().toLowerCase());
}

export function loadAdminEmail() {
  try {
    const value = localStorage.getItem(ADMIN_EMAIL_KEY) || localStorage.getItem(LEGACY_ADMIN_EMAIL_KEY);
    return value ? String(value).trim().toLowerCase() : "";
  } catch {
    return "";
  }
}

export function clearAdminEmail() {
  localStorage.removeItem(ADMIN_EMAIL_KEY);
  localStorage.removeItem(LEGACY_ADMIN_EMAIL_KEY);
}

export function loadJoinedSession() {
  try {
    const raw = localStorage.getItem(JOINED_SESSION_KEY) || localStorage.getItem(LEGACY_JOINED_SESSION_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved.sessionId || !saved.roomCode || !saved.sessionName) return null;
    return saved;
  } catch {
    return null;
  }
}

export function saveJoinedSession(session) {
  localStorage.setItem(
    JOINED_SESSION_KEY,
    JSON.stringify({
      sessionId: session.sessionId,
      roomCode: session.roomCode,
      sessionName: session.sessionName,
      joinedAt: Date.now(),
    })
  );
}

export function clearJoinedSession() {
  localStorage.removeItem(JOINED_SESSION_KEY);
  localStorage.removeItem(LEGACY_JOINED_SESSION_KEY);
}

export function clearParticipantData() {
  clearSavedProfile();
  clearJoinedSession();
  clearAdminEmail();
}

export async function findSessionByRoomCode(roomCode) {
  const raw = String(roomCode || "").trim().toUpperCase();
  if (!raw) return null;
  const candidates = [raw];
  const bare = raw.replace(/^FP-/, "");
  if (bare !== raw) candidates.push(bare);
  if (/^\d+$/.test(raw)) {
    candidates.push(`FP-${raw}`);
  }
  for (const code of candidates) {
    const snap = await getDocs(
      query(collection(db, "sessions"), where("roomCode", "==", code))
    );
    const match = snap.docs.find((docSnap) => {
      const data = docSnap.data() || {};
      return normalizeStatus(data.status) !== "draft";
    });
    if (!match) continue;
    const data = match.data() || {};
    return {
      sessionId: match.id,
      roomCode: data.roomCode || code,
      sessionName: data.sessionName || match.id,
    };
  }
  return null;
}

export function emailToDocId(email) {
  const bytes = new TextEncoder().encode(String(email).trim().toLowerCase());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function generateParticipantId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "p_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function toProfile(data) {
  return {
    participantId: data.participantId,
    name: data.name,
    email: data.email,
    institution: data.institution,
    designation: data.designation,
    createdAt: data.createdAt,
  };
}

export async function findParticipantByEmail(email) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const refDoc = doc(db, "participants", emailToDocId(normalizedEmail));
  const snapshot = await getDoc(refDoc);
  if (!snapshot.exists()) return null;
  return toProfile(snapshot.data());
}

export async function registerParticipant({ name, email, institution, designation }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const refDoc = doc(db, "participants", emailToDocId(normalizedEmail));
  const snapshot = await getDoc(refDoc);
  if (snapshot.exists()) {
    return toProfile(snapshot.data());
  }
  const profile = {
    participantId: generateParticipantId(),
    name: String(name).trim(),
    email: normalizedEmail,
    institution: String(institution).trim(),
    designation: String(designation).trim(),
    createdAt: new Date().toISOString(),
  };
  await setDoc(refDoc, profile);
  return toProfile(profile);
}

export async function updateParticipant(profile) {
  const normalizedEmail = String(profile.email).trim().toLowerCase();
  const refDoc = doc(db, "participants", emailToDocId(normalizedEmail));
  const snapshot = await getDoc(refDoc);
  const existing = snapshot.exists() ? snapshot.data() : {};
  const createdAt = profile.createdAt || existing.createdAt;
  if (!createdAt) {
    throw new Error("Participant record not found. Please sign in again.");
  }
  const updated = {
    participantId: profile.participantId || existing.participantId,
    name: String(profile.name).trim(),
    email: normalizedEmail,
    institution: String(profile.institution).trim(),
    designation: String(profile.designation).trim(),
    createdAt,
  };
  await setDoc(refDoc, updated);
  return toProfile(updated);
}
