import { initializeApp } from "firebase/app";
import {
  connectFirestoreEmulator,
  doc,
  getFirestore,
  setDoc,
} from "firebase/firestore";
import {
  newRoomCode,
  newSessionId,
  newSessionRecord,
  sessionShareUrl,
} from "../src/lib/session.js";

const app = initializeApp({ projectId: "flypollo", apiKey: "fake" });
const db = getFirestore(app);
connectFirestoreEmulator(db, "127.0.0.1", 8080);

const failures = [];

function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures.push(name);
}

const QUESTIONS = [
  {
    question: "What is the capital of France?",
    options: ["Paris", "Rome", "Madrid", "Berlin"],
    correctIndex: 0,
    type: "mcq",
  },
];

const TEN_QUESTIONS = Array.from({ length: 10 }, (_, i) => ({
  question: `Question number ${i + 1}?`,
  options: ["Option A", "Option B", "Option C", "Option D"],
  correctIndex: i % 4,
  type: "mcq",
}));

async function expectDenied(name, fn) {
  try {
    await fn();
    check(name, false);
  } catch (e) {
    check(name, true);
  }
}

async function run() {
  const adminEmail = "admin@example.com";

  const sessionId = newSessionId();
  await expectDenied("publish with empty questions", async () => {
    await setDoc(
      doc(db, "sessions", newSessionId()),
      {
        sessionId: newSessionId(),
        sessionName: "T",
        description: "",
        sessionDate: "2026-08-05",
        status: "published",
        published: true,
        createdAt: "x",
        updatedAt: "x",
        publishedAt: "x",
        publishedBy: adminEmail,
        presenter: adminEmail,
        transcriptFilename: "t.txt",
        roomCode: "FP-123456",
        shareUrl: "https://example.com",
        qrUrl: "",
        questionCount: 0,
        participantCount: 0,
        questions: [],
        analytics: {},
        draftId: sessionId,
      }
    );
  });

  try {
    const draft = {
      sessionId,
      ...newSessionRecord({
        sessionName: "Test Session",
        description: "",
        sessionDate: "2026-08-05",
      }),
    };
    await setDoc(doc(db, "sessions", sessionId), draft);
    check("create draft (empty questions)", true);
  } catch (e) {
    check("create draft (empty questions) -> " + e.message, false);
  }

  try {
    await setDoc(
      doc(db, "sessions", sessionId),
      {
        status: "draft",
        questions: QUESTIONS,
        questionCount: QUESTIONS.length,
        transcriptFilename: "transcript.txt",
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    check("saveDraft merge update", true);
  } catch (e) {
    check("saveDraft merge update -> " + e.message, false);
  }

  try {
    await setDoc(
      doc(db, "sessions", sessionId),
      {
        status: "draft",
        questions: TEN_QUESTIONS,
        questionCount: TEN_QUESTIONS.length,
        transcriptFilename: "transcript.txt",
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    check("saveDraft merge with 10 questions", true);
  } catch (e) {
    check("saveDraft merge with 10 questions -> " + e.message, false);
  }

  const legacyId = newSessionId();
  const legacy = {
    sessionId: legacyId,
    sessionName: "Legacy",
    sessionDate: "2026-01-01",
    status: "draft",
    published: false,
    createdAt: "old",
    updatedAt: "old",
    questionCount: 0,
    participantCount: 0,
    questions: [],
  };
  try {
    await setDoc(doc(db, "sessions", legacyId), legacy);
    check("create legacy-shaped draft (missing optional fields)", true);
  } catch (e) {
    check("create legacy-shaped draft -> " + e.message, false);
  }

  try {
    await setDoc(
      doc(db, "sessions", legacyId),
      {
        status: "draft",
        questions: QUESTIONS,
        questionCount: QUESTIONS.length,
        transcriptFilename: "transcript.txt",
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    check("saveDraft merge on legacy draft", true);
  } catch (e) {
    check("saveDraft merge on legacy draft -> " + e.message, false);
  }

  try {
    const publishedId = newSessionId();
    const roomCode = newRoomCode();
    const publishedAt = new Date().toISOString();
    await setDoc(
      doc(db, "sessions", publishedId),
      {
        sessionId: publishedId,
        sessionName: "Test Session",
        description: "",
        sessionDate: "2026-08-05",
        status: "published",
        published: true,
        createdAt: publishedAt,
        updatedAt: publishedAt,
        publishedAt,
        publishedBy: adminEmail,
        presenter: adminEmail,
        transcriptFilename: "transcript.txt",
        roomCode,
        shareUrl: sessionShareUrl(roomCode),
        qrUrl: "",
        questionCount: QUESTIONS.length,
        participantCount: 0,
        questions: QUESTIONS,
        analytics: {},
        draftId: sessionId,
      }
    );
    check("publish create", true);
  } catch (e) {
    check("publish create -> " + e.message, false);
  }

  console.log(
    failures.length
      ? `\n${failures.length} FAILURE(S)`
      : "\nALL RULES MATCH THE APP WRITES"
  );
  process.exit(failures.length ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
