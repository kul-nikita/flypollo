const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MAX_TRANSCRIPT_CHARS = 120000;

const baseSystemPrompt = [
  "You are a medical education assistant generating multiple-choice quiz questions for hospital staff training.",
  "Respond with ONLY valid JSON and nothing else — no markdown, no code fences, no commentary.",
  'The JSON must be an array of exactly 10 objects. Each object must have this exact shape:',
  '{"question": string, "options": [string, string, string, string], "correctIndex": number}',
  "Requirements:",
  "- Base every question strictly on content found in the provided transcript.",
  "- options is an array of exactly 4 strings.",
  "- correctIndex is the 0-based index of the correct option, from 0 to 3 inclusive.",
  "- Questions must be clinically accurate and answerable from the transcript alone.",
  "- Vary the difficulty across the set.",
].join("\n");

const retrySystemPrompt = baseSystemPrompt + [
  "",
  "STRICT FORMAT REMINDER: Your previous response could not be parsed as valid JSON.",
  'Return the array of 10 question objects only, starting with the character "[" and ending with the character "]".',
  "No prose before or after. No markdown code fences.",
  'Each object exactly: {"question": string, "options": [string, string, string, string], "correctIndex": number (0-3)}.',
].join("\n");

async function callClaude(apiKey, model, system, transcript) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: 0.4,
      system,
      messages: [{ role: "user", content: `Transcript:\n\n${transcript}` }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Anthropic API error: ${detail}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text ?? "";
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

function validateQuestions(value) {
  if (!Array.isArray(value)) {
    throw new Error("Model output is not an array");
  }
  if (value.length !== 10) {
    throw new Error(`Expected 10 questions, got ${value.length}`);
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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "ANTHROPIC_API_KEY is not set on the server",
      }),
    };
  }

  const model = process.env.MODEL_NAME || "claude-opus-4-8";

  let transcript = "";
  try {
    const body = JSON.parse(event.body || "{}");
    transcript = String(body.transcript ?? "").trim();
  } catch {
    transcript = "";
  }

  if (!transcript) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "transcript is required" }),
    };
  }
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    transcript = transcript.slice(0, MAX_TRANSCRIPT_CHARS);
  }

  let rawText;
  try {
    rawText = await callClaude(apiKey, model, baseSystemPrompt, transcript);
  } catch (err) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: String(err.message || err) }),
    };
  }

  let questions;
  try {
    questions = validateQuestions(parseQuestions(rawText));
  } catch (firstError) {
    try {
      const retryText = await callClaude(apiKey, model, retrySystemPrompt, transcript);
      questions = validateQuestions(parseQuestions(retryText));
    } catch (retryError) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: `Could not parse model output as valid JSON after a retry. First attempt: ${firstError.message}. After retry: ${retryError.message}`,
        }),
      };
    }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ count: questions.length, questions }),
  };
}
