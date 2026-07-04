"use client";

import { motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { fmtElapsed, fmtTime } from "@/lib/format";
import { ALERT_LIMIT_MIN, ALERT_LIMIT_MS } from "@/lib/occupancy";
import type { Occupant } from "@/lib/types";

interface Props {
  /** 진입 후 25분 초과 대원 (entry detected_at 기준, DB 데이터로 계산) */
  overdue: Occupant[];
  now: number | null;
}

export function AlertPanel({ overdue, now }: Props) {
  const reduceMotion = useReducedMotion();

  return (
    <section
      aria-label="미퇴장 경보"
      aria-live="polite"
      className="rounded-xl border border-edge bg-surface p-4 lg:p-5"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">미퇴장 경보</h2>
        <span
          className={`rounded-full px-3 py-1 text-sm font-bold tabular-nums ${
            overdue.length > 0
              ? "bg-danger-solid text-on-danger"
              : "bg-surface-2 text-muted"
          }`}
        >
          {overdue.length}건
        </span>
      </div>

      {overdue.length === 0 ? (
        <div className="flex items-center gap-3 rounded-lg bg-surface-2 px-4 py-6">
          <ShieldCheck className="h-6 w-6 shrink-0 text-ok" aria-hidden />
          <p className="text-base font-medium text-muted">
            {ALERT_LIMIT_MIN}분 초과 미퇴장 대원 없음
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {overdue.map((o) => {
            const elapsed = now == null ? 0 : now - o.enteredAt;
            const over = elapsed - ALERT_LIMIT_MS;
            return (
              <li
                key={o.tagMac}
                className="relative rounded-lg border-2 border-danger bg-danger-bg p-4"
              >
                {/* 점멸 링 — 본문 텍스트는 고정 유지 (가독성) */}
                <motion.div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-lg ring-4 ring-danger"
                  animate={reduceMotion ? undefined : { opacity: [1, 0.15, 1] }}
                  transition={
                    reduceMotion
                      ? undefined
                      : { duration: 1.2, repeat: Infinity, ease: "easeInOut" }
                  }
                />
                <div className="flex items-center gap-3">
                  <AlertTriangle
                    className="h-8 w-8 shrink-0 text-danger"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xl font-bold leading-tight">
                      {o.name}
                      {o.team ? (
                        <span className="ml-2 text-sm font-medium text-muted">
                          {o.team}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-sm font-medium text-muted">
                      진입 {fmtTime(new Date(o.enteredAt).toISOString())} ·{" "}
                      {ALERT_LIMIT_MIN}분 한도 {fmtElapsed(Math.max(0, over))}{" "}
                      초과
                    </p>
                  </div>
                  <p className="shrink-0 text-2xl font-bold tabular-nums text-danger">
                    {now == null ? "--:--" : fmtElapsed(elapsed)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
