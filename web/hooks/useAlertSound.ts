"use client";

import { useEffect, useRef } from "react";

/**
 * 미퇴장 경보 사운드 — overdue 목록에 새 태그가 나타나면 경보음 3회.
 * 브라우저 자동재생 정책: AudioContext는 사용자 입력 후에만 소리를 낼 수 있어
 * 첫 pointerdown/keydown에서 미리 생성·resume해 둔다.
 */
export function useAlertSound(overdueTags: string[], muted: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const prevRef = useRef<Set<string> | null>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => {
    const unlock = () => {
      try {
        ctxRef.current ??= new AudioContext();
        if (ctxRef.current.state === "suspended") void ctxRef.current.resume();
      } catch {
        // Web Audio 미지원 환경 — 사운드 없이 시각 경보만 동작
      }
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, []);

  // 정렬된 key로 비교 — 배열 재생성만으로는 재발화하지 않게
  const key = [...overdueTags].sort().join(",");

  useEffect(() => {
    const cur = new Set(key ? key.split(",") : []);
    const prev = prevRef.current ?? new Set<string>();
    prevRef.current = cur;

    const added = [...cur].some((tag) => !prev.has(tag));
    if (!added || mutedRef.current) return;

    try {
      ctxRef.current ??= new AudioContext();
      const ctx = ctxRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      const t0 = ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.value = 880;
        const start = t0 + i * 0.35;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.32);
      }
    } catch {
      // 자동재생 차단·미지원 — 시각 경보(AlertPanel)가 항상 우선 채널
    }
  }, [key]);
}
