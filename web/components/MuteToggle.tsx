"use client";

import { Volume2, VolumeX } from "lucide-react";

interface Props {
  muted: boolean;
  onToggle: () => void;
}

/** 미퇴장 경보음 음소거 토글 — 음소거 상태는 위험 신호라 danger 색으로 강조 */
export function MuteToggle({ muted, onToggle }: Props) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={muted}
      aria-label={muted ? "경보음 켜기 (현재 음소거)" : "경보음 끄기"}
      className={`flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border transition-colors duration-200 ${
        muted
          ? "border-danger bg-danger-bg text-danger hover:bg-surface-2"
          : "border-edge bg-surface text-fg hover:bg-surface-2"
      }`}
    >
      {muted ? (
        <VolumeX className="h-5 w-5" aria-hidden />
      ) : (
        <Volume2 className="h-5 w-5" aria-hidden />
      )}
    </button>
  );
}
