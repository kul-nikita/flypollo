import { collection, getDocs } from "firebase/firestore";
import { normalizeStatus } from "./session";

async function readAnswersByQuestion(db, sessionId) {
  const snap = await getDocs(collection(db, "sessions", sessionId, "answers"));
  const map = new Map();
  for (const doc of snap.docs) {
    const questionIndex = Number(doc.id);
    if (!Number.isInteger(questionIndex)) continue;
    map.set(questionIndex, doc.data() || {});
  }
  return map;
}

function buildRows(participantProfiles, questions, answers) {
  const scores = new Map();
  for (const [questionIndex, data] of answers) {
    const correctIndex = questions[questionIndex]?.correctIndex;
    if (!Number.isInteger(correctIndex)) continue;
    for (const [participantId, answer] of Object.entries(data)) {
      if (!answer || typeof answer.selectedIndex !== "number") continue;
      const entry = scores.get(participantId) || { correct: 0, answered: 0 };
      entry.answered += 1;
      if (answer.selectedIndex === correctIndex) entry.correct += 1;
      scores.set(participantId, entry);
    }
  }

  return Array.from(scores.entries())
    .map(([participantId, stats]) => {
      const profile = participantProfiles.get(participantId) || {};
      return {
        participantId,
        name: profile.name || "Unknown",
        email: profile.email || "",
        institution: profile.institution || "",
        designation: profile.designation || "",
        correct: stats.correct,
        answered: stats.answered,
        total: questions.length,
        scorePct: questions.length
          ? Math.round((stats.correct / questions.length) * 100)
          : 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listSessions(db) {
  const [sessionsSnap, participantsSnap] = await Promise.all([
    getDocs(collection(db, "sessions")),
    getDocs(collection(db, "participants")),
  ]);

  const participantProfiles = new Map(
    participantsSnap.docs
      .map((doc) => doc.data())
      .filter((p) => p.participantId)
      .map((p) => [p.participantId, p])
  );

  const sessions = [];
  for (const doc of sessionsSnap.docs) {
    const data = doc.data() || {};
    const questions = Array.isArray(data.questions) ? data.questions : [];
    const answers = await readAnswersByQuestion(db, doc.id);
    const rows = buildRows(participantProfiles, questions, answers);
    sessions.push({
      id: doc.id,
      sessionName: data.sessionName || doc.id,
      description: data.description || "",
      sessionDate: data.sessionDate || doc.id,
      status: normalizeStatus(data.status),
      roomCode: data.roomCode || "",
      questionCount: questions.length,
      participantCount: rows.length,
      avgScore: rows.length
        ? Math.round(
            rows.reduce((sum, row) => sum + row.scorePct, 0) / rows.length
          )
        : 0,
      publishedAt: data.publishedAt || "",
      questions,
      rows,
    });
  }

  sessions.sort((a, b) =>
    (b.publishedAt || b.id).localeCompare(a.publishedAt || a.id)
  );

  return sessions;
}

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function sessionToCsv(session) {
  const lines = [
    ["Name", "Email", "Institution", "Designation", "Correct", "Answered", "Total", "Score %"],
    ...session.rows.map((row) => [
      row.name,
      row.email,
      row.institution,
      row.designation,
      row.correct,
      row.answered,
      row.total,
      row.scorePct,
    ]),
  ];
  return lines.map((line) => line.map(csvEscape).join(",")).join("\n");
}

export function csvFilename(session) {
  const base = (session.sessionName || "session")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `flypollo-results-${base || session.id}.csv`;
}
