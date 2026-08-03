const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

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

  let topic = "hospital safety";
  try {
    const body = JSON.parse(event.body || "{}");
    if (body.topic) topic = String(body.topic).slice(0, 200);
  } catch {
    topic = "hospital safety";
  }

  const prompt = [
    `Create one multiple-choice question about "${topic}" for hospital staff training.`,
    'Respond with JSON only in this exact shape: {"question": "...", "options": ["A", "B", "C", "D"], "answer_index": 0, "explanation": "..."}',
    "Make the question clinically accurate and the explanation educational.",
  ].join(" ");

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-latest",
        max_tokens: 512,
        temperature: 0.7,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: `Anthropic API error: ${detail}` }),
      };
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? "";

    const stripped = text
      .replace(/```(?:json)?\s*/gi, "")
      .replace(/```/g, "")
      .trim();
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    let question = null;
    if (start !== -1 && end > start) {
      try {
        question = JSON.parse(stripped.slice(start, end + 1));
      } catch {
        question = null;
      }
    }

    if (!question || !Array.isArray(question.options)) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: "Model response was not valid JSON",
          raw: text,
        }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ topic, question }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: String(err.message || err) }),
    };
  }
}
