export function todayLocal() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function roomCodeFor(date) {
  let hash = 0;
  for (const char of date) {
    hash = (hash * 31 + char.charCodeAt(0)) % 1000000;
  }
  return `FP-${String(hash).padStart(6, "0")}`;
}
