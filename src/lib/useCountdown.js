import { useEffect, useState } from "react";

export function useCountdown(questionShownAt, seconds) {
  const [remaining, setRemaining] = useState(Number(seconds) || 0);
  useEffect(() => {
    if (!seconds || seconds <= 0) {
      setRemaining(0);
      return undefined;
    }
    const started = Number(questionShownAt) || 0;
    const tick = () => {
      const elapsed =
        started > 0 ? Math.max(0, Date.now() - started) / 1000 : 0;
      setRemaining(Math.max(0, Math.ceil(seconds - elapsed)));
    };
    tick();
    const timer = setInterval(tick, 300);
    return () => clearInterval(timer);
  }, [questionShownAt, seconds]);
  return remaining;
}
