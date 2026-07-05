export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour12: false });
}

/** 경과 시간 → "M:SS" 또는 "H:MM:SS" */
export function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** 경과 → 60초 미만 "SS초 전", 이상 "M분 SS초 전" */
export function fmtSecondsAgo(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}초 전`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s > 0 ? `${m}분 ${s}초 전` : `${m}분 전`;
}
