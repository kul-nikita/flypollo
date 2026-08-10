import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { normalizeStatus } from "./session";
import { readAnswersByQuestion } from "./report";

export function downloadTextFile(
  filename,
  text,
  mime = "text/csv;charset=utf-8;"
) {
  const body = mime.includes("csv") ? `\uFEFF${text}` : text;
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(lines) {
  return lines.map((line) => line.map(csvEscape).join(",")).join("\n");
}

function parseTimestamp(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value) {
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : time;
  }
  return null;
}

function buildRows(questions, answers, participantMap) {
  const total = questions.length;
  const scores = new Map();
  for (const [questionIndex, data] of answers) {
    const question = questions[questionIndex];
    for (const [participantId, answer] of Object.entries(data || {})) {
      if (!answer || typeof answer.selectedIndex !== "number") continue;
      const entry =
        scores.get(participantId) ||
        {
          correct: 0,
          wrong: 0,
          answered: 0,
          first: null,
          last: null,
          responseSum: 0,
          responseCount: 0,
        };
      entry.answered += 1;
      const time = parseTimestamp(answer.timestamp);
      if (time !== null && (entry.first === null || time < entry.first)) {
        entry.first = time;
      }
      if (time !== null && (entry.last === null || time > entry.last)) {
        entry.last = time;
      }
      if (
        typeof answer.responseMs === "number" &&
        answer.responseMs >= 0
      ) {
        entry.responseSum += answer.responseMs;
        entry.responseCount += 1;
      }
      if (
        question &&
        typeof question.correctIndex === "number" &&
        answer.selectedIndex === question.correctIndex
      ) {
        entry.correct += 1;
      } else {
        entry.wrong += 1;
      }
      scores.set(participantId, entry);
    }
  }
  return Array.from(scores.entries()).map(([participantId, s]) => {
    const profile = participantMap.get(participantId) || {};
    return {
      participantId,
      name: profile.name || "Unknown participant",
      email: profile.email || "",
      institution: profile.institution || "",
      designation: profile.designation || "",
      correct: s.correct,
      wrong: s.wrong,
      answered: s.answered,
      total,
      completed: s.answered === total,
      scorePct: total ? Math.round((s.correct / total) * 100) : 0,
      completionTime:
        s.first !== null && s.last !== null && s.last >= s.first
          ? s.last - s.first
          : null,
      avgResponseMs:
        s.responseCount > 0
          ? Math.round(s.responseSum / s.responseCount)
          : null,
      lastActive: s.last,
    };
  });
}

function median(sorted) {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function buildScoreDistribution(rows) {
  const buckets = Array.from({ length: 10 }, (_, i) => ({
    label: i === 9 ? "90–100%" : `${i * 10}–${i * 10 + 9}%`,
    count: 0,
  }));
  for (const row of rows) {
    const score = Math.round(row.scorePct || 0);
    const index = Math.min(9, Math.max(0, Math.floor(score / 10)));
    buckets[index].count += 1;
  }
  return buckets;
}

function computeStats(rows, totalQuestions) {
  const scores = rows.map((row) => row.scorePct).sort((a, b) => a - b);
  const completed = rows.filter((row) => row.completed).length;
  const responseTimes = rows
    .map((row) => row.avgResponseMs)
    .filter((value) => typeof value === "number");
  return {
    joined: rows.length,
    completed,
    completionRate: rows.length
      ? Math.round((completed / rows.length) * 100)
      : 0,
    avgScore: scores.length
      ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
      : 0,
    highestScore: scores.length ? scores[scores.length - 1] : 0,
    lowestScore: scores.length ? scores[0] : 0,
    medianScore: median(scores),
    totalQuestions,
    scoreDistribution: buildScoreDistribution(rows),
    avgResponseMs: responseTimes.length
      ? Math.round(
          responseTimes.reduce((sum, value) => sum + value, 0) /
            responseTimes.length
        )
      : null,
  };
}

function buildLeaderboard(rows) {
  return [...rows]
    .sort((a, b) => {
      const aTime = a.completionTime ?? Number.MAX_SAFE_INTEGER;
      const bTime = b.completionTime ?? Number.MAX_SAFE_INTEGER;
      return (
        b.scorePct - a.scorePct ||
        b.correct - a.correct ||
        aTime - bTime ||
        a.name.localeCompare(b.name)
      );
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function buildQuestionStats(questions, answers) {
  return questions.map((question, index) => {
    const data = answers.get(index) || {};
    const counts = [0, 0, 0, 0];
    const words = {};
    let answered = 0;
    let responseSum = 0;
    let responseCount = 0;
    for (const answer of Object.values(data)) {
      if (!answer) continue;
      if (typeof answer.selectedIndex === "number") {
        answered += 1;
        if (answer.selectedIndex >= 0 && answer.selectedIndex < counts.length) {
          counts[answer.selectedIndex] += 1;
        }
      } else if (typeof answer.text === "string" && answer.text.trim()) {
        answered += 1;
        const word = answer.text.trim();
        words[word] = (words[word] || 0) + 1;
      } else {
        continue;
      }
      if (typeof answer.responseMs === "number" && answer.responseMs >= 0) {
        responseSum += answer.responseMs;
        responseCount += 1;
      }
    }
    const wordcloud = !Number.isInteger(question?.correctIndex);
    const correctIndex =
      typeof question?.correctIndex === "number" ? question.correctIndex : -1;
    const correctCount = correctIndex >= 0 ? counts[correctIndex] || 0 : 0;
    const wrongCount = answered - correctCount;
    const correctPct = wordcloud
      ? null
      : answered
        ? Math.round((correctCount / answered) * 100)
        : 0;
    const incorrectPct = wordcloud
      ? null
      : answered
        ? Math.round((wrongCount / answered) * 100)
        : 0;
    let mostChosenWrong = null;
    if (correctIndex >= 0 && wrongCount > 0) {
      let mostIndex = -1;
      let mostCount = 0;
      for (let i = 0; i < counts.length; i += 1) {
        if (i === correctIndex) continue;
        if (counts[i] > mostCount) {
          mostCount = counts[i];
          mostIndex = i;
        }
      }
      if (mostIndex >= 0) {
        mostChosenWrong = {
          optionIndex: mostIndex,
          text: question?.options?.[mostIndex] || "",
          count: mostCount,
        };
      }
    }
    let difficulty = "";
    if (answered > 0 && !wordcloud) {
      if (correctPct > 80) difficulty = "Easy";
      else if (correctPct >= 50) difficulty = "Medium";
      else difficulty = "Hard";
    }
    return {
      index,
      question: question?.question || `Question ${index + 1}`,
      options: Array.isArray(question?.options) ? question.options : [],
      correctIndex,
      counts,
      words: Object.entries(words)
        .sort((a, b) => b[1] - a[1])
        .map(([word, count]) => ({ word, count })),
      answered,
      correctCount,
      wrongCount,
      correctPct,
      incorrectPct,
      mostChosenWrong,
      avgResponseMs: responseCount
        ? Math.round(responseSum / responseCount)
        : null,
      difficulty,
    };
  });
}

async function loadParticipantMap(db) {
  const snap = await getDocs(collection(db, "participants"));
  const map = new Map();
  for (const participantDoc of snap.docs) {
    const data = participantDoc.data() || {};
    if (data.participantId) map.set(data.participantId, data);
  }
  return map;
}

function computeSessionDuration(answers, data) {
  let first = null;
  let last = null;
  for (const [, byParticipant] of answers) {
    for (const entry of Object.values(byParticipant || {})) {
      const time = parseTimestamp(entry?.timestamp);
      if (time === null) continue;
      if (first === null || time < first) first = time;
      if (last === null || time > last) last = time;
    }
  }
  if (first !== null && last !== null && last >= first) return last - first;
  const published = parseTimestamp(data.publishedAt);
  const updated = parseTimestamp(data.updatedAt);
  if (published !== null && updated !== null && updated > published) {
    return updated - published;
  }
  return null;
}

export async function loadSessionAnalytics(db, sessionId) {
  if (!db || !sessionId) throw new Error("No session selected.");
  const [sessionSnap, answers, participantMap] = await Promise.all([
    getDoc(doc(db, "sessions", sessionId)),
    readAnswersByQuestion(db, sessionId),
    loadParticipantMap(db),
  ]);
  if (!sessionSnap.exists()) throw new Error("Session not found.");
  const data = sessionSnap.data() || {};
  const questions = Array.isArray(data.questions) ? data.questions : [];
  const rows = buildRows(questions, answers, participantMap);
  return {
    session: {
      id: sessionId,
      sessionName: data.sessionName || sessionId,
      description: data.description || "",
      sessionDate: data.sessionDate || "",
      roomCode: data.roomCode || "",
      status: normalizeStatus(data.status),
      questionCount: questions.length,
      presenter: data.presenter || "",
      createdAt: data.createdAt || "",
      publishedAt: data.publishedAt || "",
      updatedAt: data.updatedAt || "",
    },
    questions,
    answers,
    rows,
    durationMs: computeSessionDuration(answers, data),
    stats: computeStats(rows, questions.length),
    leaderboard: buildLeaderboard(rows),
    questionStats: buildQuestionStats(questions, answers),
  };
}

export function participantsCsv(rows) {
  const lines = [
    ["Rank", "Name", "Email", "Institution", "Designation", "Correct", "Wrong", "Score %", "Completed", "Completion Time (s)"],
    ...rows.map((row, index) => [
      index + 1,
      row.name,
      row.email,
      row.institution,
      row.designation,
      row.correct,
      row.wrong,
      row.scorePct,
      row.completed ? "Yes" : "No",
      row.completionTime === null ? "" : Math.round(row.completionTime / 1000),
    ]),
  ];
  return toCsv(lines);
}

function optionLetter(index) {
  return String.fromCharCode(65 + index);
}

export function answersCsv(questions, answers, rows) {
  const lines = [
    ["Participant", "Email", "Question", "Question Text", "Response", "Correct Option", "Correct"],
    ...rows.flatMap((row) =>
      questions.map((question, qIndex) => {
        const entry = (answers.get(qIndex) || {})[row.participantId];
        let selected = null;
        let text = null;
        if (entry && typeof entry.selectedIndex === "number") {
          selected = entry.selectedIndex;
        } else if (entry && typeof entry.text === "string") {
          text = entry.text;
        }
        const hasCorrect = Number.isInteger(question.correctIndex);
        return [
          row.name,
          row.email,
          qIndex + 1,
          question.question,
          selected === null
            ? text === null
              ? "—"
              : text
            : optionLetter(selected),
          hasCorrect ? optionLetter(question.correctIndex) : "—",
          selected === null
            ? "—"
            : hasCorrect && selected === question.correctIndex
              ? "Yes"
              : "No",
        ];
      })
    ),
  ];
  return toCsv(lines);
}

export function sessionPdfReport() {
  throw new Error("PDF export is not available yet.");
}

export function sessionAnalyticsJson(data) {
  return JSON.stringify(
    {
      session: data.session,
      durationMs: data.durationMs,
      stats: data.stats,
      leaderboard: data.leaderboard,
      questionStats: data.questionStats,
      participants: data.rows,
    },
    null,
    2
  );
}
