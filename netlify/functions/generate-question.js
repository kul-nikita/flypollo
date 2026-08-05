const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

const DEFAULT_MODEL = "gemini-flash-latest";
const REQUEST_TIMEOUT_MS = 30000;
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const systemPrompt = [
  "You are an assistant generating one multiple-choice question for hospital staff training.",
  'Respond with ONLY valid JSON and nothing else — no markdown, no code fences, no commentary, in this exact shape:',
  '{"question": string, "options": [string, string, string, string], "answer_index": number (0-3), "explanation": string}',
  "Make the question clinically accurate and the explanation educational.",
].join(" ");

function geminiFailure(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function geminiErrorMessage(detail) {
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

function classifyGeminiError(status, detail, model) {
  const message = geminiErrorMessage(detail);
  if (status === 401 || status === 403 || (status === 400 && /api key/i.test(message))) {
    return geminiFailure(
      "The Gemini API key is invalid. Check GEMINI_API_KEY in your Netlify environment settings.",
      500
    );
  }
  if (status === 429) {
    return geminiFailure(
      "The Gemini API rate limit was exceeded. Wait a moment and try again.",
      503
    );
  }
  if (status === 404 && /model/i.test(message)) {
    return geminiFailure(
      `The Gemini model "${model}" is not available. Set MODEL_NAME in your Netlify environment to a valid model such as ${DEFAULT_MODEL}.`,
      500
    );
  }
  if (status >= 500) {
    return geminiFailure(
      `The Gemini API is temporarily unavailable (${status}). Try again in a moment.`,
      502
    );
  }
  return geminiFailure(`Gemini API error (${status}): ${message || detail}`, 502);
}

async function callGemini(apiKey, model, prompt) {
  const url = `${GEMINI_BASE_URL}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS) || REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 512,
          responseMimeType: "application/json",
        },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw geminiFailure("The Gemini API request timed out. Try again.", 504);
    }
    throw geminiFailure(
      `Could not reach the Gemini API (${err.message}). Check your network connection and try again.`,
      502
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw classifyGeminiError(response.status, await response.text(), model);
  }

  const data = await response.json();
  const text =
    data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  if (!text.trim()) {
    throw geminiFailure("Gemini returned an empty response", 502);
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

export default async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "GEMINI_API_KEY is not set on the server",
      }),
    };
  }

  const model = process.env.MODEL_NAME || DEFAULT_MODEL;

  let topic = "hospital safety";
  try {
    const body = JSON.parse(event.body || "{}");
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
    rawText = await callGemini(apiKey, model, prompt);
  } catch (err) {
    return {
      statusCode: err.statusCode || 502,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }

  let question;
  try {
    question = validateQuestion(parseQuestion(rawText));
  } catch (err) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({
        error: `The Gemini API returned a response that could not be used: ${err.message}`,
      }),
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ topic, question }),
  };
}
