import {
  collection,
  deleteDoc,
  doc,
  getDocs,
} from "firebase/firestore";
import { normalizeStatus, sessionShareUrl } from "./session";

export async function readAnswersByQuestion(db, sessionId) {
  const snap = await getDocs(collection(db, "sessions", sessionId, "answers"));
  const map = new Map();
  for (const doc of snap.docs) {
    const questionIndex = Number(doc.id);
    if (!Number.isInteger(questionIndex)) continue;
    map.set(questionIndex, doc.data() || {});
  }
  return map;
}

export function parseTimestamp(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value) {
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : time;
  }
  return null;
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
      published: Boolean(data.published),
      roomCode: data.roomCode || "",
      shareUrl:
        data.shareUrl ||
        (data.roomCode ? sessionShareUrl(data.roomCode) : ""),
      qrUrl: data.qrUrl || "",
      questionCount: questions.length,
      participantCount: rows.length,
      avgScore: rows.length
        ? Math.round(
            rows.reduce((sum, row) => sum + row.scorePct, 0) / rows.length
          )
        : 0,
      publishedAt: data.publishedAt || "",
      presenter: data.presenter || "",
      transcriptFilename: data.transcriptFilename || "",
      analytics: data.analytics || {},
      draftId: data.draftId || "",
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
  return `flygamify-results-${base || session.id}.csv`;
}

export function sessionsToCsv(sessions, analyticsMap = null) {
  const base = [
    "Session",
    "Date",
    "Status",
    "Room Code",
    "Questions",
    "Participants",
    "Average Score %",
    "Published At",
    "Share Link",
  ];
  const analyticsCols = [
    "Completion %",
    "Highest %",
    "Lowest %",
    "Median %",
    "Avg Response (ms)",
    "Duration",
  ];
  const lines = [
    [...base, ...(analyticsMap ? analyticsCols : [])],
    ...sessions.map((s) => {
      const stats = analyticsMap?.get(s.id) || null;
      return [
        s.sessionName,
        s.sessionDate,
        s.status,
        s.roomCode,
        s.questionCount,
        s.participantCount,
        s.avgScore,
        s.publishedAt,
        s.shareUrl,
        ...(analyticsMap
          ? [
              stats ? stats.completionRate : "",
              stats ? stats.highestScore : "",
              stats ? stats.lowestScore : "",
              stats ? stats.medianScore : "",
              stats ? stats.avgResponseMs : "",
              stats ? stats.durationMs : "",
            ]
          : []),
      ];
    }),
  ];
  return lines.map((line) => line.map(csvEscape).join(",")).join("\n");
}

export function participantStatsCsv(rows) {
  const lines = [
    ["Name", "Email", "Institution", "Designation", "Sessions Joined", "Answers", "Correct", "Average Accuracy %", "Last Active"],
    ...rows.map((row) => [
      row.name,
      row.email,
      row.institution,
      row.designation,
      row.sessionsJoined,
      row.answered,
      row.correct,
      row.accuracy === null ? "" : row.accuracy,
      row.lastActive ? new Date(row.lastActive).toISOString() : "",
    ]),
  ];
  return lines.map((line) => line.map(csvEscape).join(",")).join("\n");
}

export async function listParticipantStats(db) {
  const [participantsSnap, sessionsSnap] = await Promise.all([
    getDocs(collection(db, "participants")),
    getDocs(collection(db, "sessions")),
  ]);

  const participantProfiles = new Map(
    participantsSnap.docs
      .map((doc) => doc.data())
      .filter((p) => p.participantId)
      .map((p) => [p.participantId, p])
  );

  const joined = new Map();
  for (const sessionDoc of sessionsSnap.docs) {
    const data = sessionDoc.data() || {};
    const questions = Array.isArray(data.questions) ? data.questions : [];
    const answers = await readAnswersByQuestion(db, sessionDoc.id);
    for (const [questionIndex, byParticipant] of answers) {
      const correctIndex = questions[questionIndex]?.correctIndex;
      for (const [participantId, answer] of Object.entries(byParticipant || {})) {
        if (!answer) continue;
        const entry =
          joined.get(participantId) || {
            sessions: new Set(),
            last: 0,
            answered: 0,
            correct: 0,
          };
        entry.sessions.add(sessionDoc.id);
        const time = parseTimestamp(answer.timestamp);
        if (time !== null && time > entry.last) entry.last = time;
        if (typeof answer.selectedIndex === "number") {
          entry.answered += 1;
          if (
            Number.isInteger(correctIndex) &&
            answer.selectedIndex === correctIndex
          ) {
            entry.correct += 1;
          }
        }
        joined.set(participantId, entry);
      }
    }
  }

  const rows = [];
  for (const p of participantProfiles.values()) {
    const stats = joined.get(p.participantId);
    rows.push({
      participantId: p.participantId,
      name: p.name || "Unknown",
      email: p.email || "",
      institution: p.institution || "",
      designation: p.designation || "",
      sessionsJoined: stats ? stats.sessions.size : 0,
      lastActive: stats ? stats.last : 0,
      answered: stats ? stats.answered : 0,
      correct: stats ? stats.correct : 0,
      accuracy:
        stats && stats.answered > 0
          ? Math.round((stats.correct / stats.answered) * 100)
          : null,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

export async function deleteSession(db, sessionId) {
  await deleteDoc(doc(db, "sessions", sessionId));
}

export async function listParticipantSessions(db, participantId) {
  if (!participantId) return [];
  const sessionsSnap = await getDocs(collection(db, "sessions"));
  const results = [];
  for (const sessionDoc of sessionsSnap.docs) {
    const data = sessionDoc.data() || {};
    const questions = Array.isArray(data.questions) ? data.questions : [];
    const answersSnap = await getDocs(
      collection(db, "sessions", sessionDoc.id, "answers")
    );
    let answered = 0;
    let correct = 0;
    let lastActive = 0;
    let found = false;
    for (const answerDoc of answersSnap.docs) {
      const questionIndex = Number(answerDoc.id);
      const question = questions[questionIndex];
      const entry = (answerDoc.data() || {})[participantId];
      if (!entry || typeof entry.selectedIndex !== "number") continue;
      found = true;
      answered += 1;
      if (
        question &&
        typeof question.correctIndex === "number" &&
        entry.selectedIndex === question.correctIndex
      ) {
        correct += 1;
      }
      const lastTime = parseTimestamp(entry.timestamp);
      if (lastTime !== null && lastTime > lastActive) {
        lastActive = lastTime;
      }
    }
    if (!found) continue;
    results.push({
      sessionId: sessionDoc.id,
      sessionName: data.sessionName || sessionDoc.id,
      sessionDate: data.sessionDate || sessionDoc.id,
      status: normalizeStatus(data.status),
      roomCode: data.roomCode || "",
      questionCount: questions.length,
      answered,
      correct,
      scorePct: questions.length
        ? Math.round((correct / questions.length) * 100)
        : 0,
      lastActive,
    });
  }
  results.sort(
    (a, b) =>
      (b.lastActive || 0) - (a.lastActive || 0) ||
      b.sessionDate.localeCompare(a.sessionDate)
  );
  return results;
}
