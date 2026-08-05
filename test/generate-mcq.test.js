import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";
import handler, {
  DEFAULT_REQUEST_TIMEOUT_MS,
  FUNCTION_MAX_DURATION_MS,
  DEADLINE_SLACK_MS,
  RETRY_MIN_BUDGET_MS,
  attemptBudget,
  canRetry,
  geminiWindowMs,
} from "../netlify/functions/generate-mcq.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.GEMINI_API_KEY;
  delete process.env.MODEL_NAME;
  delete process.env.REQUEST_TIMEOUT_MS;
});

function postEvent(body) {
  return new Request("https://flypollo.netlify.app/.netlify/functions/generate-mcq", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function invoke(event) {
  const response = await handler(event);
  const text = await response.text();
  return {
    statusCode: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : "",
  };
}

function geminiOk(partsText) {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        candidates: [
          { content: { role: "model", parts: [{ text: partsText }] } },
        ],
      };
    },
    async text() {
      return "";
    },
  };
}

function geminiError(status, detail) {
  return {
    ok: false,
    status,
    async json() {
      throw new Error("invalid json");
    },
    async text() {
      return detail;
    },
  };
}

function installFetch(responses) {
  const calls = [];
  let index = 0;
  globalThis.fetch = async (url, options) => {
    const entry = { url, options, body: JSON.parse(options.body) };
    calls.push(entry);
    const responder = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return typeof responder === "function" ? responder(url, options) : responder;
  };
  return {
    calls,
    count: () => calls.length,
    last: () => calls[calls.length - 1],
  };
}

const TOPICS = [
  "course outcomes",
  "Bloom's taxonomy",
  "constructive alignment",
  "assessment rubrics",
  "formative assessment",
  "summative assessment",
  "program outcomes",
  "action verbs",
  "attainment",
  "feedback",
];

const TEN_QUESTIONS = TOPICS.map((topic, i) => ({
  question: `Which statement about ${topic} is correct?`,
  options: ["Option A", "Option B", "Option C", "Option D"],
  correctIndex: i % 4,
}));
const TEN_JSON = JSON.stringify(TEN_QUESTIONS);

const FDP_TRANSCRIPT = [
  "Dr. Rao: Good morning, colleagues. Welcome to the Faculty Development Program on outcome-based education.",
  "Prof. Iyer: Let's start with Bloom's taxonomy. Remember the six levels: remember, understand, apply, analyze, evaluate, create.",
  "Dr. Rao: Course outcomes should be measurable and mapped to program outcomes.",
  "Prof. Iyer: A well-written outcome uses an action verb like 'design' or 'evaluate' rather than 'understand'.",
  "Dr. Rao: Use constructive alignment — teaching methods and assessments must match the stated outcomes.",
  "Prof. Iyer: Assessment rubrics should be shared with students before the task so expectations are transparent.",
  "Dr. Rao: For program-level assessment, map course outcomes to program outcomes and compute attainment.",
  "Prof. Iyer: Use rubrics with explicit criteria to grade open-ended tasks reliably.",
  "Dr. Rao: Remember the difference between formative assessment during learning and summative assessment at the end.",
  "Prof. Iyer: Please bring your course handouts tomorrow for the hands-on outcome-writing workshop.",
].join("\n");

const TRANSCRIPT_MARKER = "Bloom's taxonomy";

function runTenQuestionSuccess(transcript) {
  const mock = installFetch([geminiOk(TEN_JSON)]);
  return { mock, res: invoke(postEvent({ transcript })) };
}

describe("generate-mcq.js", () => {
  test("reads process.env.GEMINI_API_KEY and rejects when missing", async () => {
    const mock = installFetch([geminiOk(TEN_JSON)]);
    delete process.env.GEMINI_API_KEY;
    const res = await invoke(postEvent({ transcript: "any" }));
    assert.equal(res.statusCode, 500);
    const data = res.body;
    assert.match(data.error, /GEMINI_API_KEY/);
    assert.match(data.error, /not set/);
    assert.equal(mock.count(), 0, "must not call Gemini without a key");
  });

  test("uses gemini-flash-latest model by default", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    delete process.env.MODEL_NAME;
    const { mock, res } = runTenQuestionSuccess("any transcript");
    const result = await res;
    assert.equal(result.statusCode, 200);
    assert.match(mock.last().url, /\/models\/gemini-flash-latest:generateContent/);
  });

  test("honors MODEL_NAME override", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    process.env.MODEL_NAME = "gemini-2.5-pro";
    const { mock, res } = runTenQuestionSuccess("any transcript");
    await res;
    assert.match(mock.last().url, /\/models\/gemini-2.5-pro:generateContent/);
  });

  test("uses the correct Gemini generateContent endpoint", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    const { mock, res } = runTenQuestionSuccess("any transcript");
    await res;
    assert.ok(
      mock.last().url.startsWith(
        "https://generativelanguage.googleapis.com/v1beta/models/"
      ),
      mock.last().url
    );
    assert.ok(
      mock.last().url.includes(":generateContent?key=test-key-123"),
      mock.last().url
    );
  });

  test("sends correct request headers (key in URL, no x-api-key)", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    const { mock, res } = runTenQuestionSuccess("any transcript");
    await res;
    const headers = mock.last().options.headers;
    assert.equal(headers["Content-Type"], "application/json");
    assert.equal(headers["content-type"], undefined);
    assert.equal(headers["x-api-key"], undefined);
    assert.equal(headers["anthropic-version"], undefined);
  });

  test("sends correct request body (systemInstruction, contents, generationConfig)", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    const { mock, res } = runTenQuestionSuccess("any transcript");
    await res;
    const body = mock.last().body;
    assert.equal(typeof body.systemInstruction, "object");
    assert.equal(body.systemInstruction.parts[0].text, baseSystemPromptText());
    assert.equal(body.contents[0].role, "user");
    assert.ok(body.contents[0].parts[0].text.startsWith("Transcript:\n\n"));
    assert.equal(typeof body.generationConfig, "object");
    assert.equal(body.generationConfig.maxOutputTokens, 8192);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
  });

  test("formats the system prompt for 10-MCQ JSON output", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    const { mock, res } = runTenQuestionSuccess("any transcript");
    await res;
    const system = mock.last().body.systemInstruction.parts[0].text;
    assert.match(system, /exactly 10 objects/);
    assert.match(system, /"options": \[string, string, string, string\]/);
    assert.match(system, /correctIndex/);
    assert.match(system, /0 to 3/);
    assert.match(system, /exactly 4 strings/);
  });

  test("injects the transcript into the request body", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    const { mock, res } = runTenQuestionSuccess(FDP_TRANSCRIPT);
    await res;
    const sent = mock.last().body.contents[0].parts[0].text;
    assert.ok(sent.includes(TRANSCRIPT_MARKER), "transcript marker missing");
    assert.ok(sent.includes("course outcomes"), "transcript content missing");
    assert.ok(sent.includes("formative assessment"), "transcript content missing");
  });

  test("returns valid JSON with exactly 10 questions on success", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    const { res } = runTenQuestionSuccess(FDP_TRANSCRIPT);
    const result = await res;
    assert.equal(result.statusCode, 200);
    assert.equal(result.headers.get("Access-Control-Allow-Origin"), "*");
    const data = result.body;
    assert.equal(data.count, 10);
    assert.equal(Array.isArray(data.questions), true);
    assert.equal(data.questions.length, 10);
  });

  test("every question has question, options (length 4) and correctIndex", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    const { res } = runTenQuestionSuccess(FDP_TRANSCRIPT);
    const data = (await res).body;
    for (const q of data.questions) {
      assert.equal(typeof q.question, "string");
      assert.ok(q.question.trim().length > 0);
      assert.equal(Array.isArray(q.options), true);
      assert.equal(q.options.length, 4);
      assert.equal(typeof q.correctIndex, "number");
    }
  });

  test("correctIndex is always an integer in 0-3", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    const { res } = runTenQuestionSuccess(FDP_TRANSCRIPT);
    const data = (await res).body;
    for (const q of data.questions) {
      assert.ok(Number.isInteger(q.correctIndex));
      assert.ok(q.correctIndex >= 0 && q.correctIndex <= 3);
    }
  });

  test("rejects questions whose correctIndex is out of range", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    const bad = JSON.parse(TEN_JSON);
    bad[0].correctIndex = 7;
    const badJson = JSON.stringify(bad);
    const mock = installFetch([geminiOk(badJson), geminiOk(badJson)]);
    const res = await invoke(postEvent({ transcript: "short" }));
    assert.equal(res.statusCode, 502);
    assert.match(res.body.error, /correctIndex out of range/);
    assert.equal(mock.count(), 2, "should retry before failing");
  });

  test("handles malformed Gemini text gracefully (retry, then useful 502)", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    const mock = installFetch([geminiOk("this is not json at all"), geminiOk("still nope")]);
    const res = await invoke(postEvent({ transcript: FDP_TRANSCRIPT }));
    assert.equal(res.statusCode, 502);
    const data = res.body;
    assert.match(data.error, /Could not parse model output as valid JSON after a retry/);
    assert.match(data.error, /First attempt:/);
    assert.match(data.error, /After retry:/);
    assert.equal(mock.count(), 2);
    assert.match(
      mock.last().body.systemInstruction.parts[0].text,
      /STRICT FORMAT REMINDER/
    );
  });

  test("recovers via retry when the first response is malformed", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    const mock = installFetch([geminiOk("not json"), geminiOk(TEN_JSON)]);
    const res = await invoke(postEvent({ transcript: FDP_TRANSCRIPT }));
    assert.equal(res.statusCode, 200);
    const data = res.body;
    assert.equal(data.questions.length, 10);
    assert.equal(mock.count(), 2);
  });

  test("strips markdown code fences from Gemini output", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    const fenced = "```json\n" + TEN_JSON + "\n```";
    const mock = installFetch([geminiOk(fenced)]);
    const res = await invoke(postEvent({ transcript: FDP_TRANSCRIPT }));
    const data = res.body;
    assert.equal(data.questions.length, 10);
    assert.equal(mock.count(), 1, "should not need a retry for fenced JSON");
  });

  test("tolerates prose around the JSON array", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    const withProse = "Here are the questions you asked for:\n\n" + TEN_JSON + "\n\nThat is all.";
    const mock = installFetch([geminiOk(withProse)]);
    const res = await invoke(postEvent({ transcript: FDP_TRANSCRIPT }));
    const data = res.body;
    assert.equal(data.questions.length, 10);
    assert.equal(mock.count(), 1);
  });

  test("returns a useful 502 when Gemini returns an empty response", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    const mock = installFetch([geminiOk("   ")]);
    const res = await invoke(postEvent({ transcript: FDP_TRANSCRIPT }));
    assert.equal(res.statusCode, 502);
    assert.match(res.body.error, /Gemini returned an empty response/);
    assert.equal(mock.count(), 1, "no retry for transport/empty failures");
  });

  test("returns a friendly 503 when the Gemini rate limit is exceeded", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    const mock = installFetch([geminiError(429, "rate limit exceeded")]);
    const res = await invoke(postEvent({ transcript: FDP_TRANSCRIPT }));
    assert.equal(res.statusCode, 503);
    const data = res.body;
    assert.match(data.error, /rate limit/);
    assert.match(data.error, /try again/);
    assert.equal(mock.count(), 1);
  });

  test("returns a friendly error for an invalid API key", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    const mock = installFetch([
      geminiError(400, "API key not valid. Please pass a valid API key."),
    ]);
    const res = await invoke(postEvent({ transcript: FDP_TRANSCRIPT }));
    assert.equal(res.statusCode, 500);
    const data = res.body;
    assert.match(data.error, /GEMINI_API_KEY/);
    assert.match(data.error, /invalid/);
    assert.equal(mock.count(), 1);
  });

  test("returns a friendly error when the model is unavailable", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    delete process.env.MODEL_NAME;
    const mock = installFetch([
      geminiError(
        404,
        "This model models/gemini-flash-latest is not available to new users."
      ),
    ]);
    const res = await invoke(postEvent({ transcript: FDP_TRANSCRIPT }));
    assert.equal(res.statusCode, 500);
    const data = res.body;
    assert.match(data.error, /gemini-flash-latest/);
    assert.match(data.error, /MODEL_NAME/);
    assert.equal(mock.count(), 1);
  });

  test("returns a friendly error on a Gemini 5xx failure", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    const mock = installFetch([geminiError(500, "internal error")]);
    const res = await invoke(postEvent({ transcript: FDP_TRANSCRIPT }));
    assert.equal(res.statusCode, 502);
    const data = res.body;
    assert.match(data.error, /temporarily unavailable/);
    assert.equal(mock.count(), 1);
  });

  test("handles an empty candidates response gracefully", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      async json() {
        return { candidates: [] };
      },
      async text() {
        return "";
      },
    });
    const res = await invoke(postEvent({ transcript: FDP_TRANSCRIPT }));
    assert.equal(res.statusCode, 502);
    assert.match(res.body.error, /Gemini returned an empty response/);
  });

  test("times out a hung Gemini request and returns 502", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    process.env.REQUEST_TIMEOUT_MS = "100";
    installFetch([
      (url, options) =>
        new Promise((resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    ]);
    const res = await invoke(postEvent({ transcript: "short transcript" }));
    assert.equal(res.statusCode, 504);
    assert.match(res.body.error, /timed out/);
  });

  test("passes an AbortController signal to fetch", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    const { mock, res } = runTenQuestionSuccess("any transcript");
    await res;
    assert.ok(
      mock.last().options.signal instanceof AbortSignal,
      "fetch must receive an abort signal"
    );
  });

  test("rejects an empty transcript (400, no API call)", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    for (const body of [
      {},
      { transcript: "" },
      { transcript: "   \n  " },
      "this is not json",
      null,
    ]) {
      const mock = installFetch([geminiOk(TEN_JSON)]);
      const res = await invoke(postEvent(body));
      assert.equal(res.statusCode, 400, JSON.stringify(body));
      assert.match(res.body.error, /transcript is required/);
      assert.equal(mock.count(), 0, "must not call Gemini without a transcript");
    }
  });

  test("handles a short transcript", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    const { mock, res } = runTenQuestionSuccess(
      "Heart attack symptoms include chest pain and shortness of breath."
    );
    const result = await res;
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.questions.length, 10);
    assert.ok(mock.last().body.contents[0].parts[0].text.includes("chest pain"));
  });

  test("handles a short transcript where the model under-produces", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    const few = JSON.stringify(TEN_QUESTIONS.slice(0, 3));
    const mock = installFetch([geminiOk(few), geminiOk(few)]);
    const res = await invoke(postEvent({ transcript: "Only one fact here." }));
    assert.equal(res.statusCode, 502);
    const data = res.body;
    assert.match(data.error, /Expected 10 questions, got 3/);
    assert.match(data.error, /First attempt:/);
    assert.equal(mock.count(), 2);
  });

  test("truncates a transcript longer than MAX_TRANSCRIPT_CHARS", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    const longTranscript = "a".repeat(130000);
    const { mock, res } = runTenQuestionSuccess(longTranscript);
    const result = await res;
    assert.equal(result.statusCode, 200);
    const sent = mock.last().body.contents[0].parts[0].text;
    const prefix = "Transcript:\n\n";
    const idx = sent.indexOf(prefix);
    assert.ok(idx !== -1);
    assert.equal(sent.slice(idx + prefix.length).length, 120000);
  });

  test("works end-to-end with a realistic FDP transcript", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    const mock = installFetch([geminiOk(TEN_JSON)]);
    const res = await invoke(postEvent({ transcript: FDP_TRANSCRIPT }));
    const result = await res;
    assert.equal(result.statusCode, 200);
    const data = result.body;
    assert.equal(data.count, 10);
    assert.equal(data.questions.length, 10);
    const sent = mock.last().body.contents[0].parts[0].text;
    assert.ok(sent.includes("Dr. Rao"));
    assert.ok(sent.includes("outcome-based education"));
  });

  test("keeps the frontend response format unchanged", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    const { res } = runTenQuestionSuccess(FDP_TRANSCRIPT);
    const data = (await res).body;
    assert.deepEqual(Object.keys(data).sort(), ["count", "questions"]);
    for (const q of data.questions) {
      assert.deepEqual(Object.keys(q).sort(), ["correctIndex", "options", "question"]);
    }
  });

  test("responds to CORS preflight (OPTIONS)", async () => {
    const res = await invoke(
      new Request("https://flypollo.netlify.app/.netlify/functions/generate-mcq", {
        method: "OPTIONS",
      })
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(res.headers.get("Access-Control-Allow-Headers"), "Content-Type");
  });

  test("rejects non-POST methods with 405", async () => {
    const res = await invoke(
      new Request("https://flypollo.netlify.app/.netlify/functions/generate-mcq", {
        method: "GET",
      })
    );
    assert.equal(res.statusCode, 405);
    assert.match(res.body.error, /Method not allowed/);
  });

  test("exports a Netlify-compatible default handler", () => {
    assert.equal(typeof handler, "function");
    assert.equal(handler.length, 1);
  });
});

describe("generate-mcq.js time budget", () => {
  test("default per-attempt timeout fits inside the 26s function max duration", () => {
    assert.equal(FUNCTION_MAX_DURATION_MS, 26 * 1000);
    assert.ok(DEFAULT_REQUEST_TIMEOUT_MS < FUNCTION_MAX_DURATION_MS);
    assert.ok(DEFAULT_REQUEST_TIMEOUT_MS > 0);
    const first = attemptBudget(DEFAULT_REQUEST_TIMEOUT_MS, 0);
    assert.ok(first > 0, "a fresh attempt must always get a positive budget");
    assert.ok(first <= DEFAULT_REQUEST_TIMEOUT_MS);
    assert.ok(first < FUNCTION_MAX_DURATION_MS);
  });

  test("clamps the per-attempt timeout to the remaining window", () => {
    assert.equal(attemptBudget(60_000, 0), geminiWindowMs());
    assert.equal(
      attemptBudget(60_000, 23_000),
      geminiWindowMs() - 23_000
    );
    assert.equal(attemptBudget(60_000, geminiWindowMs()), 0);
    assert.equal(attemptBudget(60_000, 99_000), 0);
    assert.equal(attemptBudget(60_000, -1_000), geminiWindowMs());
  });

  test("honors a lower REQUEST_TIMEOUT_MS override as-is", () => {
    assert.equal(attemptBudget(100, 0), 100);
  });

  test("first attempt plus retry can never exceed the 26s window", () => {
    // Worst case: the first attempt consumes its entire budget before the
    // retry is budgeted, so first + retry must still fit in the window.
    for (const firstBudget of [0, 5_000, 15_000, 20_000, geminiWindowMs()]) {
      const consumed = firstBudget;
      const retry = canRetry(consumed)
        ? attemptBudget(DEFAULT_REQUEST_TIMEOUT_MS, consumed)
        : 0;
      assert.ok(
        firstBudget + retry <= geminiWindowMs(),
        `first ${firstBudget} + retry ${retry} exceeds window at consumed ${consumed}`
      );
    }
  });

  test("canRetry is false once the window is nearly exhausted", () => {
    assert.equal(canRetry(0), true);
    assert.equal(canRetry(geminiWindowMs() - RETRY_MIN_BUDGET_MS + 1), false);
    assert.equal(canRetry(geminiWindowMs()), false);
    assert.equal(canRetry(FUNCTION_MAX_DURATION_MS), false);
  });

  test("REQUEST_TIMEOUT_MS=100 still times out a hung Gemini request", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    process.env.REQUEST_TIMEOUT_MS = "100";
    installFetch([
      (url, options) =>
        new Promise((resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    ]);
    const res = await invoke(postEvent({ transcript: "short transcript" }));
    assert.equal(res.statusCode, 504);
    assert.match(res.body.error, /timed out/);
  });
});

function baseSystemPromptText() {
  return [
    "You are an academic education assistant generating multiple-choice quiz questions for faculty development program (FDP) participants.",
    "Respond with ONLY valid JSON and nothing else — no markdown, no code fences, no commentary.",
    'The JSON must be an array of exactly 10 objects. Each object must have this exact shape:',
    '{"question": string, "options": [string, string, string, string], "correctIndex": number}',
    "Requirements:",
    "- Base every question strictly on content found in the provided transcript.",
    "- options is an array of exactly 4 strings.",
    "- correctIndex is the 0-based index of the correct option, from 0 to 3 inclusive.",
    "- Questions must be accurate and answerable from the transcript alone.",
    "- Vary the difficulty across the set.",
  ].join("\n");
}
