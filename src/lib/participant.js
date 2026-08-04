import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";

const STORAGE_KEY = "flypollo.participant";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function loadSavedProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved.savedAt || !saved.participantId || !saved.email) return null;
    if (Date.now() - saved.savedAt > WEEK_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
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
