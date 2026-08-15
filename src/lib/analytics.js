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

function pdfDuration(ms) {
  if (ms == null) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function pdfDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function barHtml(pct, label, value, tone = "") {
  const width = Math.min(100, Math.max(0, Number(pct) || 0));
  return `
    <div class="bar-row">
      <div class="bar-label"><span>${label}</span><span>${value}</span></div>
      <div class="bar-track"><div class="bar-fill ${tone}" style="width:${width}%"></div></div>
    </div>`;
}

function questionHtml(q) {
  const wordcloud = !Number.isInteger(q.correctIndex);
  const dist = wordcloud
    ? (q.words || [])
        .map(
          (w) =>
            `<div class="word-row"><span>${w.word}</span><span>${w.count}</span></div>`
        )
        .join("")
    : q.options
        .map((option, i) => {
          const count = q.counts[i] || 0;
          const pct = q.answered ? Math.round((count / q.answered) * 100) : 0;
          return barHtml(
            pct,
            `${String.fromCharCode(65 + i)} — ${option}`,
            `${count} · ${pct}%`,
            i === q.correctIndex ? "correct" : ""
          );
        })
        .join("");
  const correctLine = wordcloud
    ? ""
    : `<p class="correct-line">Correct answer: <strong>${
        String.fromCharCode(65 + q.correctIndex)
      } — ${q.options[q.correctIndex] || "—"}</strong></p>`;
  return `
    <div class="question">
      <h3>Question ${q.index + 1}${wordcloud ? " (Word cloud)" : ""}</h3>
      <p class="qtext">${q.question}</p>
      ${correctLine}
      <p class="metrics">
        ${wordcloud ? "" : `<span>Correct ${q.correctPct}%</span><span>Incorrect ${q.incorrectPct}%</span>`}
        <span>${q.answered} response${q.answered === 1 ? "" : "s"}</span>
        <span>Avg time ${pdfDuration(q.avgResponseMs)}</span>
      </p>
      <div class="dist">${dist}</div>
    </div>`;
}

export function sessionPdfReport(data) {
  if (!data || !data.session) throw new Error("No analytics to export.");
  const { session, stats, leaderboard, questionStats, durationMs } = data;
  const rows = data.rows || [];
  const wordcloudQuestions = questionStats.filter(
    (q) => !Number.isInteger(q.correctIndex)
  ).length;

  const statsHtml = `
    <div class="stat-grid">
      <div class="stat"><strong>${stats.joined}</strong><span>Participants</span></div>
      <div class="stat"><strong>${stats.completionRate}%</strong><span>Completion</span></div>
      <div class="stat"><strong>${stats.avgScore}%</strong><span>Average score</span></div>
      <div class="stat"><strong>${stats.highestScore}%</strong><span>Highest score</span></div>
      <div class="stat"><strong>${stats.lowestScore}%</strong><span>Lowest score</span></div>
      <div class="stat"><strong>${pdfDuration(durationMs)}</strong><span>Duration</span></div>
    </div>`;

  const leaderboardHtml =
    leaderboard.length === 0
      ? `<p class="empty">No participants answered.</p>`
      : `<table>
          <thead>
            <tr><th>Rank</th><th>Name</th><th>Institution</th><th>Score %</th><th>Correct</th></tr>
          </thead>
          <tbody>
            ${leaderboard
              .map(
                (row) =>
                  `<tr><td>${row.rank}</td><td>${row.name}</td><td>${
                    row.institution || "—"
                  }</td><td>${row.scorePct}%</td><td>${row.correct}/${
                    row.total
                  }</td></tr>`
              )
              .join("")}
          </tbody>
        </table>`;

  const questionsHtml =
    questionStats.length === 0
      ? `<p class="empty">No questions recorded.</p>`
      : questionStats.map(questionHtml).join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${session.sessionName} — Report</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111111; margin: 0; padding: 2rem; }
  .head { border-bottom: 3px solid #dc2626; padding-bottom: 1rem; margin-bottom: 1.5rem; }
  .head h1 { margin: 0 0 0.25rem; font-size: 1.4rem; }
  .head .sub { margin: 0; color: #64748b; font-size: 0.85rem; }
  .stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-bottom: 1.5rem; }
  .stat { border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.75rem; }
  .stat strong { display: block; font-size: 1.2rem; }
  .stat span { font-size: 0.8rem; color: #64748b; }
  h2 { font-size: 1.05rem; margin: 1.5rem 0 0.5rem; color: #111111; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th, td { border: 1px solid #e2e8f0; padding: 0.45rem 0.6rem; text-align: left; }
  th { background: #f1f5f9; }
  .question { border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; page-break-inside: avoid; }
  .question h3 { margin: 0 0 0.25rem; font-size: 0.95rem; color: #dc2626; }
  .qtext { margin: 0 0 0.5rem; font-weight: 600; }
  .correct-line { margin: 0 0 0.5rem; font-size: 0.85rem; }
  .metrics { display: flex; flex-wrap: wrap; gap: 1rem; font-size: 0.8rem; color: #475569; margin: 0 0 0.75rem; }
  .bar-row { margin-bottom: 0.5rem; }
  .bar-label { display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 0.2rem; }
  .bar-track { background: #f1f5f9; border-radius: 4px; height: 12px; overflow: hidden; }
  .bar-fill { height: 100%; background: #dc2626; }
  .bar-fill.correct { background: #10b981; }
  .word-row { display: flex; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding: 0.35rem 0; font-size: 0.85rem; }
  .empty { color: #64748b; font-size: 0.85rem; }
  .footer { margin-top: 2rem; font-size: 0.75rem; color: #94a3b8; text-align: center; }
  @media print { body { padding: 0.5rem; } }
</style>
</head>
<body>
  <div class="head">
    <h1>${session.sessionName}</h1>
    <p class="sub">${pdfDate(session.sessionDate)} · Room ${session.roomCode || "—"} · Presenter ${session.presenter || "—"}${wordcloudQuestions ? ` · ${wordcloudQuestions} word cloud question(s)` : ""}</p>
  </div>
  <h2>Overview</h2>
  ${statsHtml}
  <h2>Leaderboard</h2>
  ${leaderboardHtml}
  <h2>Question Analysis</h2>
  ${questionsHtml}
  <p class="footer">Generated by FlyPollo · ${new Date().toLocaleString()}</p>
  <script>window.print()<\/script>
</body>
</html>`;

  const win = window.open("", "_blank", "width=900,height=1200");
  if (!win) throw new Error("Pop-up blocked. Allow pop-ups to export the PDF report.");
  win.document.open();
  win.document.write(html);
  win.document.close();
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
