"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { WifiOff } from "lucide-react";
import { fmtSecondsAgo } from "@/lib/format";
import { HEARTBEAT_LOST_MS } from "@/lib/occupancy";
import type { Heartbeat } from "@/lib/types";

interface Props {
  heartbeats: Heartbeat[];
  now: number | null;
}

/** heartbeats.last_seen이 180초 초과 지연된 Pi가 있으면 "현장 통신 두절" 배너 (60~180초 '지연'은 KPI 카드만) */
export function ConnectionBanner({ heartbeats, now }: Props) {
  const reduceMotion = useReducedMotion();

  const stale =
    now == null
      ? []
      : heartbeats.filter(
          (hb) => now - Date.parse(hb.last_seen) >= HEARTBEAT_LOST_MS,
        );

  return (
    <AnimatePresence>
      {stale.length > 0 && now != null && (
        <motion.div
          key="comm-lost"
          role="alert"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -48 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -48 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="relative bg-danger-solid text-on-danger"
        >
          {/* 배너 전체 빨간 점멸 — 텍스트는 z-위로 고정 유지 (가독성) */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-danger"
            animate={reduceMotion ? undefined : { opacity: [0, 0.5, 0] }}
            transition={
              reduceMotion
                ? undefined
                : { duration: 1.2, repeat: Infinity, ease: "easeInOut" }
            }
          />
          <div className="relative mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 lg:px-6">
            <WifiOff className="h-6 w-6 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="text-lg font-bold leading-tight">현장 통신 두절</p>
              <p className="truncate text-sm font-medium opacity-90">
                {stale
                  .map(
                    (hb) =>
                      `${hb.pi_id} 마지막 수신 ${fmtSecondsAgo(
                        now - Date.parse(hb.last_seen),
                      )}`,
                  )
                  .join(" · ")}
                {" — "}이벤트는 Pi 로컬 큐에 보존되며 복구 시 재전송됩니다
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
