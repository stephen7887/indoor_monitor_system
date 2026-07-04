"use client";

import { useEffect, useState } from "react";

/**
 * 1초 간격으로 갱신되는 현재 시각(epoch ms).
 * SSR/hydration 불일치를 피하기 위해 마운트 전에는 null.
 */
export function useNow(intervalMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
