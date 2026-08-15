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

const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const REQUEST_TIMEOUT_MS = 24000;
const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";

const systemPrompt = [
  "You are an assistant generating one multiple-choice question for hospital staff training.",
  'Respond with ONLY valid JSON and nothing else — no markdown, no code fences, no commentary, in this exact shape:',
  '{"question": string, "options": [string, string, string, string], "answer_index": number (0-3), "explanation": string}',
  "Make the question clinically accurate and the explanation educational.",
].join(" ");

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

async function callGroq(apiKey, model, prompt) {
  const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS) || REQUEST_TIMEOUT_MS;
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
        temperature: 0.7,
        max_tokens: 512,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
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

function parseQuestion(text) {
  const stripped = text
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("No JSON object found in model output");
  }
  return JSON.parse(stripped.slice(start, end + 1));
}

function validateQuestion(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Model output is not an object");
  }
  const question = String(value.question ?? "").trim();
  if (!question) {
    throw new Error("Model output has an empty question");
  }
  if (!Array.isArray(value.options) || value.options.length !== 4) {
    throw new Error("Model output must have exactly 4 options");
  }
  const options = value.options.map((option) => String(option ?? "").trim());
  if (options.some((option) => !option)) {
    throw new Error("Model output has an empty option");
  }
  const answerIndex = Number(value.answer_index);
  if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) {
    throw new Error("Model output has answer_index out of range 0-3");
  }
  const explanation = String(value.explanation ?? "").trim();
  if (!explanation) {
    throw new Error("Model output has an empty explanation");
  }
  return { question, options, answer_index: answerIndex, explanation };
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

  let topic = "hospital safety";
  try {
    const body = await req.json();
    if (body.topic) topic = String(body.topic).slice(0, 200);
  } catch {
    topic = "hospital safety";
  }

  const prompt = [
    `Create one multiple-choice question about "${topic}" for hospital staff training.`,
    systemPrompt,
  ].join(" ");

  let rawText;
  try {
    rawText = await callGroq(apiKey, model, prompt);
  } catch (err) {
    return jsonResponse(err.statusCode || 502, { error: err.message });
  }

  let question;
  try {
    question = validateQuestion(parseQuestion(rawText));
  } catch (err) {
    return jsonResponse(502, {
      error: `The Groq API returned a response that could not be used: ${err.message}`,
    });
  }

  return jsonResponse(200, { topic, question });
}
