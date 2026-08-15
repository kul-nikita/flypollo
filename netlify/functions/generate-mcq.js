const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(statusCode, payload) {
  return new Response(JSON.stringify(payload), {
    status: statusCode,
    headers,
  });
}

const MAX_TRANSCRIPT_CHARS = 120000;
export const ALLOWED_COUNTS = [2, 5, 10];
export const DEFAULT_COUNT = 10;
// Per-attempt Groq timeout. Must fit inside FUNCTION_MAX_DURATION_MS so the
// function always returns before Netlify kills it. Defaults to the full
// 24s window (26s max duration minus 2s deadline slack). Override with
// REQUEST_TIMEOUT_MS in the Netlify environment if needed.
export const DEFAULT_REQUEST_TIMEOUT_MS = 24000;
// Must match maxDuration = 26 in netlify.toml (max on the free plan).
export const FUNCTION_MAX_DURATION_MS = 26 * 1000;
// Time reserved after the last Groq call for parsing, validation, and
// building the response so the total never reaches maxDuration.
export const DEADLINE_SLACK_MS = 2000;
// A retry only helps if a meaningful budget remains.
export const RETRY_MIN_BUDGET_MS = 5000;
// Production model verified against Groq's supported-models docs
// (https://console.groq.com/docs/models). Override with MODEL_NAME.
const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";

export function groqWindowMs() {
  return FUNCTION_MAX_DURATION_MS - DEADLINE_SLACK_MS;
}

export function attemptBudget(requestTimeoutMs, elapsedMs) {
  const remaining = Math.min(groqWindowMs(), groqWindowMs() - elapsedMs);
  return Math.max(0, Math.min(requestTimeoutMs, remaining));
}

export function canRetry(elapsedMs) {
  return groqWindowMs() - elapsedMs >= RETRY_MIN_BUDGET_MS;
}

export function normalizeCount(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_COUNT;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || !ALLOWED_COUNTS.includes(parsed)) {
    return null;
  }
  return parsed;
}

function baseSystemPrompt(count) {
  return [
    "You are an academic education assistant generating multiple-choice quiz questions for faculty development program (FDP) participants.",
    "Respond with ONLY valid JSON and nothing else — no markdown, no code fences, no commentary.",
    `The JSON must be an array of exactly ${count} objects. Each object must have this exact shape:`,
    '{"question": string, "options": [string, string, string, string], "correctIndex": number}',
    "Requirements:",
    "- Base every question strictly on content found in the provided transcript.",
    "- options is an array of exactly 4 strings.",
    "- correctIndex is the 0-based index of the correct option, from 0 to 3 inclusive.",
    "- Questions must be accurate and answerable from the transcript alone.",
    "- Vary the difficulty across the set.",
  ].join("\n");
}

function retrySystemPrompt(count) {
  return baseSystemPrompt(count) + [
    "",
    "STRICT FORMAT REMINDER: Your previous response could not be parsed as valid JSON.",
    `Return the array of ${count} question objects only, starting with the character "[" and ending with the character "]".`,
    "No prose before or after. No markdown code fences.",
    'Each object exactly: {"question": string, "options": [string, string, string, string], "correctIndex": number (0-3)}.',
  ].join("\n");
}

function groqFailure(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function groqErrorMessage(detail) {
  try {
    const parsed = JSON.parse(detail);
    if (parsed && typeof parsed.error?.message === "string") {
      return parsed.error.message.trim();
    }
  } catch {
    // not JSON — fall through to the raw body
  }
  return String(detail || "").trim();
}

function classifyGroqError(status, detail, model) {
  const message = groqErrorMessage(detail);
  if (status === 401 || status === 403 || (status === 400 && /api key/i.test(message))) {
    return groqFailure(
      "The Groq API key is invalid. Check GROQ_API_KEY in your Netlify environment settings.",
      500
    );
  }
  if (status === 429) {
    return groqFailure(
      "The Groq API rate limit was exceeded. Wait a moment and try again.",
      503
    );
  }
  if (status === 404 && /model/i.test(message)) {
    return groqFailure(
      `The Groq model "${model}" is not available. Set MODEL_NAME in your Netlify environment to a valid model such as ${DEFAULT_MODEL}.`,
      500
    );
  }
  if (status >= 500) {
    return groqFailure(
      `The Groq API is temporarily unavailable (${status}). Try again in a moment.`,
      502
    );
  }
  return groqFailure(`Groq API error (${status}): ${message || detail}`, 502);
}

async function callGroq(apiKey, model, system, transcript, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(GROQ_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 8192,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Transcript:\n\n${transcript}` },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw groqFailure("The Groq API request timed out. Try again.", 504);
    }
    throw groqFailure(
      `Could not reach the Groq API (${err.message}). Check your network connection and try again.`,
      502
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw classifyGroqError(response.status, await response.text(), model);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) {
    throw groqFailure("Groq returned an empty response", 502);
  }
  return text;
}

function parseQuestions(text) {
  const stripped = text
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = stripped.indexOf("[");
  const end = stripped.lastIndexOf("]");
  if (start === -1 || end <= start) {
    throw new Error("No JSON array found in model output");
  }
  return JSON.parse(stripped.slice(start, end + 1));
}

function validateQuestions(value, expectedCount) {
  if (!Array.isArray(value)) {
    throw new Error("Model output is not an array");
  }
  if (value.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} questions, got ${value.length}`);
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Item ${index} is not an object`);
    }
    const question = String(item.question ?? "").trim();
    if (!question) {
      throw new Error(`Item ${index} has an empty question`);
    }
    if (!Array.isArray(item.options) || item.options.length !== 4) {
      throw new Error(`Item ${index} must have exactly 4 options`);
    }
    const options = item.options.map((option) => String(option ?? "").trim());
    if (options.some((option) => !option)) {
      throw new Error(`Item ${index} has an empty option`);
    }
    const correctIndex = Number(item.correctIndex);
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
      throw new Error(`Item ${index} has correctIndex out of range 0-3`);
    }
    return { question, options, correctIndex };
  });
}

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return jsonResponse(500, {
      error: "GROQ_API_KEY is not set on the server",
    });
  }

  const model = process.env.MODEL_NAME || DEFAULT_MODEL;

  let transcript = "";
  let count = DEFAULT_COUNT;
  try {
    const body = await req.json();
    transcript = String(body?.transcript ?? "").trim();
    count = normalizeCount(body?.count);
  } catch {
    transcript = "";
  }

  if (!transcript) {
    return jsonResponse(400, { error: "transcript is required" });
  }
  if (count === null) {
    return jsonResponse(400, {
      error: `count must be one of ${ALLOWED_COUNTS.join(", ")}`,
    });
  }
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    transcript = transcript.slice(0, MAX_TRANSCRIPT_CHARS);
  }

  const requestTimeoutMs =
    Number(process.env.REQUEST_TIMEOUT_MS) || DEFAULT_REQUEST_TIMEOUT_MS;
  const startedAt = Date.now();

  let rawText;
  const firstBudget = attemptBudget(requestTimeoutMs, Date.now() - startedAt);
  if (firstBudget <= 0) {
    return jsonResponse(504, {
      error: "The Groq request timed out before it could start. Try again.",
    });
  }
  try {
    rawText = await callGroq(
      apiKey,
      model,
      baseSystemPrompt(count),
      transcript,
      firstBudget
    );
  } catch (err) {
    return jsonResponse(err.statusCode || 502, { error: err.message });
  }

  let questions;
  try {
    questions = validateQuestions(parseQuestions(rawText), count);
  } catch (firstError) {
    const retryElapsedMs = Date.now() - startedAt;
    if (!canRetry(retryElapsedMs)) {
      return jsonResponse(502, {
        error: `Could not parse model output as valid JSON before the function time limit. First attempt: ${firstError.message}`,
      });
    }
    try {
      const retryText = await callGroq(
        apiKey,
        model,
        retrySystemPrompt(count),
        transcript,
        attemptBudget(requestTimeoutMs, retryElapsedMs)
      );
      questions = validateQuestions(parseQuestions(retryText), count);
    } catch (retryError) {
      return jsonResponse(502, {
        error: `Could not parse model output as valid JSON after a retry. First attempt: ${firstError.message}. After retry: ${retryError.message}`,
      });
    }
  }

  return jsonResponse(200, { count: questions.length, questions });
}
