import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";
import handler from "../netlify/functions/generate-question.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.GROQ_API_KEY;
  delete process.env.MODEL_NAME;
  delete process.env.REQUEST_TIMEOUT_MS;
});

function postEvent(body) {
  return new Request("https://flypollo.netlify.app/.netlify/functions/generate-question", {
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

const QUESTION = {
  question: "Which of the following is a core step of cardiac arrest care?",
  options: ["Defibrillation", "Feeding", "Sleeping", "Walking"],
  answer_index: 0,
  explanation: "Early defibrillation is a core step in cardiac arrest care.",
};
const QUESTION_JSON = JSON.stringify(QUESTION);

function groqOk(contentText) {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        choices: [{ message: { role: "assistant", content: contentText } }],
      };
    },
    async text() {
      return "";
    },
  };
}

function groqError(status, detail) {
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

describe("generate-question.js", () => {
  test("uses llama-3.3-70b-versatile model by default", async () => {
    process.env.GROQ_API_KEY = "test-key-123";
    delete process.env.MODEL_NAME;
    const mock = installFetch([groqOk(QUESTION_JSON)]);
    const res = await invoke(postEvent({ topic: "cardiac arrest" }));
    assert.equal(res.statusCode, 200);
    assert.equal(mock.last().body.model, "llama-3.3-70b-versatile");
    assert.equal(mock.last().url, "https://api.groq.com/openai/v1/chat/completions");
  });

  test("honors MODEL_NAME override", async () => {
    process.env.GROQ_API_KEY = "test-key-123";
    process.env.MODEL_NAME = "openai/gpt-oss-120b";
    const mock = installFetch([groqOk(QUESTION_JSON)]);
    await invoke(postEvent({ topic: "cardiac arrest" }));
    assert.equal(mock.last().body.model, "openai/gpt-oss-120b");
  });

  test("rejects when GROQ_API_KEY is missing", async () => {
    const mock = installFetch([groqOk(QUESTION_JSON)]);
    delete process.env.GROQ_API_KEY;
    const res = await invoke(postEvent({ topic: "cardiac arrest" }));
    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /GROQ_API_KEY/);
    assert.equal(mock.count(), 0);
  });

  test("returns a friendly error for an invalid API key", async () => {
    process.env.GROQ_API_KEY = "test-key-123";
    const mock = installFetch([
      groqError(400, "API key not valid. Please pass a valid API key."),
    ]);
    const res = await invoke(postEvent({ topic: "cardiac arrest" }));
    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /invalid/);
    assert.equal(mock.count(), 1);
  });

  test("returns a friendly 503 when the Groq rate limit is exceeded", async () => {
    process.env.GROQ_API_KEY = "test-key-123";
    const mock = installFetch([groqError(429, "rate limit exceeded")]);
    const res = await invoke(postEvent({ topic: "cardiac arrest" }));
    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /rate limit/);
    assert.equal(mock.count(), 1);
  });

  test("returns a friendly error when the model is unavailable", async () => {
    process.env.GROQ_API_KEY = "test-key-123";
    delete process.env.MODEL_NAME;
    const mock = installFetch([
      groqError(
        404,
        "The model llama-3.3-70b-versatile does not exist or you do not have access to it."
      ),
    ]);
    const res = await invoke(postEvent({ topic: "cardiac arrest" }));
    assert.equal(res.statusCode, 500);
    assert.match(res.body.error, /MODEL_NAME/);
    assert.equal(mock.count(), 1);
  });

  test("returns success with the expected shape", async () => {
    process.env.GROQ_API_KEY = "test-key-123";
    const mock = installFetch([groqOk(QUESTION_JSON)]);
    const res = await invoke(postEvent({ topic: "cardiac arrest" }));
    assert.equal(res.statusCode, 200);
    assert.equal(mock.count(), 1);
    const data = res.body;
    assert.equal(data.topic, "cardiac arrest");
    assert.deepEqual(Object.keys(data.question).sort(), [
      "answer_index",
      "explanation",
      "options",
      "question",
    ]);
  });

  test("returns 502 for malformed model output", async () => {
    process.env.GROQ_API_KEY = "test-key-123";
    const mock = installFetch([groqOk("this is not json")]);
    const res = await invoke(postEvent({ topic: "cardiac arrest" }));
    assert.equal(res.statusCode, 502);
    assert.match(res.body.error, /could not be used/);
    assert.equal(mock.count(), 1);
  });

  test("rejects an empty response", async () => {
    process.env.GROQ_API_KEY = "test-key-123";
    const mock = installFetch([groqOk("   ")]);
    const res = await invoke(postEvent({ topic: "cardiac arrest" }));
    assert.equal(res.statusCode, 502);
    assert.match(res.body.error, /empty response/);
    assert.equal(mock.count(), 1);
  });

  test("responds to CORS preflight (OPTIONS)", async () => {
    const res = await invoke(
      new Request("https://flypollo.netlify.app/.netlify/functions/generate-question", {
        method: "OPTIONS",
      })
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  });

  test("rejects non-POST methods with 405", async () => {
    const res = await invoke(
      new Request("https://flypollo.netlify.app/.netlify/functions/generate-question", {
        method: "GET",
      })
    );
    assert.equal(res.statusCode, 405);
    assert.match(res.body.error, /Method not allowed/);
  });
});
