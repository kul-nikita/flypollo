export const QUESTION_TYPES = {
  mcq: "mcq",
  poll: "poll",
  wordcloud: "wordcloud",
};

export const DEFAULT_TIMER_SECONDS = 30;

export function emptyQuestion(type = "mcq") {
  if (type === "poll") {
    return {
      type: "poll",
      question: "",
      options: ["", ""],
      correctIndex: null,
      timerSeconds: DEFAULT_TIMER_SECONDS,
    };
  }
  if (type === "wordcloud") {
    return {
      type: "wordcloud",
      question: "",
      options: [],
      correctIndex: null,
      timerSeconds: DEFAULT_TIMER_SECONDS,
    };
  }
  return {
    type: "mcq",
    question: "",
    options: ["", "", "", ""],
    correctIndex: 0,
    timerSeconds: DEFAULT_TIMER_SECONDS,
  };
}

export function normalizeQuestion(q) {
  const item = q && typeof q === "object" ? q : {};
  const type = QUESTION_TYPES[item.type] || "mcq";
  const base = {
    type,
    question: String(item.question ?? ""),
    correctIndex:
      Number.isInteger(item.correctIndex) && item.correctIndex >= 0
        ? item.correctIndex
        : type === "mcq"
          ? 0
          : null,
    timerSeconds: Number.isInteger(item.timerSeconds)
      ? Math.min(300, Math.max(0, item.timerSeconds))
      : DEFAULT_TIMER_SECONDS,
  };
  if (type === "mcq") {
    const options = Array.isArray(item.options)
      ? item.options.slice(0, 4)
      : ["", "", "", ""];
    while (options.length < 4) options.push("");
    return { ...base, options: options.map((o) => String(o ?? "")) };
  }
  if (type === "poll") {
    const options = Array.isArray(item.options)
      ? item.options.map((o) => String(o ?? ""))
      : ["", ""];
    return { ...base, options: options.length >= 2 ? options : ["", ""] };
  }
  return { ...base, options: [] };
}

export function normalizeQuestions(items) {
  return (Array.isArray(items) ? items : []).map(normalizeQuestion);
}

export function isChoiceQuestion(q) {
  return q && (q.type === "mcq" || q.type === "poll");
}

export function isMcq(q) {
  return q && q.type === "mcq";
}

export function validationError(questions) {
  if (questions.length === 0) {
    return "Add at least one question before continuing.";
  }
  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i];
    if (!q.question.trim()) {
      return `Question ${i + 1} needs some text.`;
    }
    if (q.type === "mcq") {
      if (q.options.length !== 4 || q.options.some((option) => !option.trim())) {
        return `Question ${i + 1} needs 4 non-empty options.`;
      }
      if (
        !Number.isInteger(q.correctIndex) ||
        q.correctIndex < 0 ||
        q.correctIndex > 3
      ) {
        return `Question ${i + 1} needs a correct answer selected.`;
      }
    }
    if (q.type === "poll") {
      if (q.options.length < 2 || q.options.some((option) => !option.trim())) {
        return `Question ${i + 1} needs at least 2 non-empty options.`;
      }
    }
  }
  return "";
}
