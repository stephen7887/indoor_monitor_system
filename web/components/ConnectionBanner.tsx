"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { WifiOff } from "lucide-react";
import { fmtSecondsAgo } from "@/lib/format";
import { HEARTBEAT_STALE_MS } from "@/lib/occupancy";
import type { Heartbeat } from "@/lib/types";

interface Props {
  heartbeats: Heartbeat[];
  now: number | null;
}

/** heartbeats.last_seen이 60초 이상 오래된 Pi가 있으면 "현장 통신 두절" 배너 */
export function ConnectionBanner({ heartbeats, now }: Props) {
  const reduceMotion = useReducedMotion();

  const stale =
    now == null
      ? []
      : heartbeats.filter(
          (hb) => now - Date.parse(hb.last_seen) >= HEARTBEAT_STALE_MS,
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
          className="bg-danger-solid text-on-danger"
        >
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 lg:px-6">
            <motion.span
              animate={reduceMotion ? undefined : { opacity: [1, 0.4, 1] }}
              transition={
                reduceMotion
                  ? undefined
                  : { duration: 1.2, repeat: Infinity, ease: "easeInOut" }
              }
              className="shrink-0"
            >
              <WifiOff className="h-6 w-6" aria-hidden />
            </motion.span>
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
