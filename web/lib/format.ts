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

export function fmtSecondsAgo(ms: number): string {
  return `${Math.max(0, Math.round(ms / 1000))}초 전`;
}
