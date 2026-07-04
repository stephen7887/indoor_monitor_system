"use client";

import { CheckCircle2, User } from "lucide-react";
import { fmtElapsed, fmtTime } from "@/lib/format";
import {
  ALERT_LIMIT_MS,
  occupantStatus,
  type OccupantStatus,
} from "@/lib/occupancy";
import type { Occupant } from "@/lib/types";

interface Props {
  occupants: Occupant[];
  now: number | null;
}

const STATUS_LABEL: Record<OccupantStatus, string> = {
  ok: "정상",
  warn: "주의",
  danger: "경보",
};

const STATUS_TEXT: Record<OccupantStatus, string> = {
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
};

const STATUS_CARD: Record<OccupantStatus, string> = {
  ok: "border-edge bg-surface",
  warn: "border-warn bg-warn-bg",
  danger: "border-danger bg-danger-bg",
};

const STATUS_BAR: Record<OccupantStatus, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
};

/** 현재 내부 인원 (태그별 최신 이벤트가 entry인 대원) */
export function OccupantList({ occupants, now }: Props) {
  return (
    <section
      aria-label="현재 내부 인원"
      className="rounded-xl border border-edge bg-surface p-4 lg:p-5"
    >
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-bold">내부 인원</h2>
        <p className="text-sm font-medium text-muted">
          진입 후 미퇴장 대원 · 25분 초과 시 경보
        </p>
      </div>

      {occupants.length === 0 ? (
        <div className="flex items-center gap-3 rounded-lg bg-surface-2 px-4 py-6">
          <CheckCircle2 className="h-6 w-6 shrink-0 text-ok" aria-hidden />
          <p className="text-base font-medium text-muted">
            내부 인원 없음 — 전 대원 외부
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {occupants.map((o) => {
            const elapsed = now == null ? 0 : now - o.enteredAt;
            const status = now == null ? "ok" : occupantStatus(elapsed);
            const progress = Math.min(1, elapsed / ALERT_LIMIT_MS);
            return (
              <li
                key={o.tagMac}
                className={`rounded-lg border-2 p-4 transition-colors duration-300 ${STATUS_CARD[status]}`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2">
                      <User className="h-5 w-5 text-muted" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xl font-bold leading-tight">
                        {o.name}
                      </p>
                      <p className="truncate text-sm font-medium text-muted">
                        {o.team ? `${o.team} · ` : ""}
                        {o.tagMac} · 진입 {fmtTime(new Date(o.enteredAt).toISOString())}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className={`text-2xl font-bold tabular-nums leading-tight ${STATUS_TEXT[status]}`}
                    >
                      {now == null ? "--:--" : fmtElapsed(elapsed)}
                    </p>
                    <p className={`text-sm font-bold ${STATUS_TEXT[status]}`}>
                      {STATUS_LABEL[status]}
                    </p>
                  </div>
                </div>
                {/* 25분 한도 대비 경과 게이지 */}
                <div
                  role="progressbar"
                  aria-label={`25분 한도 대비 경과 (${o.name})`}
                  aria-valuenow={Math.round(progress * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2"
                >
                  <div
                    className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${STATUS_BAR[status]}`}
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
