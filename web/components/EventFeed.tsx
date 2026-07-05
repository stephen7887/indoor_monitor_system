"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeftFromLine, ArrowRightToLine, Inbox } from "lucide-react";
import { fmtTime } from "@/lib/format";
import { UnregisteredBadge } from "@/components/OccupantList";
import type { FireEvent, Firefighter } from "@/lib/types";

interface Props {
  events: FireEvent[];
  firefighters: Firefighter[];
}

const FEED_LIMIT = 50;

/** Supabase Realtime으로 수신한 진출입 이벤트 실시간 피드 */
export function EventFeed({ events, firefighters }: Props) {
  const reduceMotion = useReducedMotion();

  const nameByMac = useMemo(
    () => new Map(firefighters.map((f) => [f.tag_mac, f.name])),
    [firefighters],
  );

  const sorted = useMemo(
    () =>
      [...events]
        .sort((a, b) => Date.parse(b.detected_at) - Date.parse(a.detected_at))
        .slice(0, FEED_LIMIT),
    [events],
  );

  return (
    <section
      aria-label="진출입 이벤트 피드"
      className="rounded-xl border border-edge bg-surface p-4 lg:p-5"
    >
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-bold">실시간 진출입</h2>
        <p className="text-sm font-medium text-muted">최근 {FEED_LIMIT}건</p>
      </div>

      {sorted.length === 0 ? (
        <div className="flex items-center gap-3 rounded-lg bg-surface-2 px-4 py-6">
          <Inbox className="h-6 w-6 shrink-0 text-muted" aria-hidden />
          <p className="text-base font-medium text-muted">
            최근 24시간 이벤트 없음
          </p>
        </div>
      ) : (
        <ul className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
          {sorted.map((ev) => {
            const isEntry = ev.direction === "entry";
            return (
              <motion.li
                key={ev.id}
                initial={reduceMotion ? false : { opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2.5"
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                    isEntry ? "bg-warn-bg text-warn" : "bg-ok-bg text-ok"
                  }`}
                >
                  {isEntry ? (
                    <ArrowRightToLine className="h-5 w-5" aria-hidden />
                  ) : (
                    <ArrowLeftFromLine className="h-5 w-5" aria-hidden />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-2 text-base font-bold leading-tight">
                    <span className="truncate">
                      {nameByMac.get(ev.tag_mac) ?? ev.tag_mac}
                    </span>
                    {!nameByMac.has(ev.tag_mac) && <UnregisteredBadge />}
                    <span
                      className={`shrink-0 text-sm font-bold ${
                        isEntry ? "text-warn" : "text-ok"
                      }`}
                    >
                      {isEntry ? "진입" : "진출"}
                    </span>
                  </p>
                  <p className="truncate text-sm font-medium text-muted">
                    {ev.site_id}
                    {ev.cross_sec != null
                      ? ` · 통과 ${ev.cross_sec.toFixed(1)}초`
                      : ""}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-medium tabular-nums text-muted">
                  {fmtTime(ev.detected_at)}
                </p>
              </motion.li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
