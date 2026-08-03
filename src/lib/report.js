import { collection, getDocs } from "firebase/firestore";

export async function generateReport(db, from, to) {
  const [participantsSnap, sessionsSnap] = await Promise.all([
    getDocs(collection(db, "participants")),
    getDocs(collection(db, "sessions")),
  ]);

  const participants = participantsSnap.docs
    .map((doc) => doc.data())
    .filter((p) => p.participantId)
    .map((p) => ({
      participantId: p.participantId,
      name: p.name || "Unknown",
      email: p.email || "",
      institution: p.institution || "",
      designation: p.designation || "",
    }));

  const sessions = sessionsSnap.docs
    .map((doc) => ({ date: doc.id, ...doc.data() }))
    .filter((s) => s.date >= from && s.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date));

  const days = sessions.map((s) => s.date);

  const rows = new Map(
    participants.map((p) => [p.participantId, { ...p, scores: {}, total: 0 }])
  );

  for (const session of sessions) {
    const questions = Array.isArray(session.questions) ? session.questions : [];
    const answersSnap = await getDocs(
      collection(db, "sessions", session.date, "answers")
    );
    for (const answerDoc of answersSnap.docs) {
      const questionIndex = Number(answerDoc.id);
      const correctIndex = questions[questionIndex]?.correctIndex;
      if (
        !Number.isInteger(questionIndex) ||
        !Number.isInteger(correctIndex)
      ) {
        continue;
      }
      const data = answerDoc.data() || {};
      for (const [participantId, answer] of Object.entries(data)) {
        const row = rows.get(participantId);
        if (!row) continue;
        if (answer && answer.selectedIndex === correctIndex) {
          row.scores[session.date] = (row.scores[session.date] || 0) + 1;
          row.total += 1;
        }
      }
    }
  }

  const table = Array.from(rows.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  return { days, rows: table };
}

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(days, rows) {
  const lines = [
    ["Name", "Email", "Institution", "Designation", ...days, "Total"],
    ...rows.map((row) => [
      row.name,
      row.email,
      row.institution,
      row.designation,
      ...days.map((day) => row.scores[day] || 0),
      row.total,
    ]),
  ];
  return lines.map((line) => line.map(csvEscape).join(",")).join("\n");
}
