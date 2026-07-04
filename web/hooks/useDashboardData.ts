"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { FireEvent, Firefighter, Heartbeat } from "@/lib/types";

const LOOKBACK_MS = 24 * 60 * 60 * 1000; // 최근 24시간 이벤트로 재실현
const MAX_EVENTS = 1000;

export type RealtimeStatus = "connecting" | "connected" | "disconnected";

export function useDashboardData() {
  const [events, setEvents] = useState<FireEvent[]>([]);
  const [firefighters, setFirefighters] = useState<Firefighter[]>([]);
  const [heartbeats, setHeartbeats] = useState<Heartbeat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [realtime, setRealtime] = useState<RealtimeStatus>("connecting");

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let cancelled = false;

    async function loadInitial() {
      const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
      const [ev, ff, hb] = await Promise.all([
        client
          .from("events")
          .select("*")
          .gte("detected_at", since)
          .order("detected_at", { ascending: false })
          .limit(MAX_EVENTS),
        client.from("firefighters").select("*").eq("active", true),
        client.from("heartbeats").select("*"),
      ]);
      if (cancelled) return;

      const firstError = ev.error ?? ff.error ?? hb.error;
      if (firstError) {
        setError(firstError.message);
      } else {
        setEvents((ev.data as FireEvent[]) ?? []);
        setFirefighters((ff.data as Firefighter[]) ?? []);
        setHeartbeats((hb.data as Heartbeat[]) ?? []);
        setError(null);
      }
      setLoading(false);
    }

    loadInitial();

    const channel = client
      .channel("dashboard")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "events" },
        (payload) => {
          const ev = payload.new as FireEvent;
          // events.id는 결정성 uuid — 재전송 중복 insert는 upsert로 막히지만
          // realtime 중복 수신 대비 id로 한 번 더 dedupe
          setEvents((prev) =>
            prev.some((e) => e.id === ev.id)
              ? prev
              : [ev, ...prev].slice(0, MAX_EVENTS),
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "heartbeats" },
        (payload) => {
          const hb = payload.new as Heartbeat;
          if (!hb?.pi_id) return;
          setHeartbeats((prev) => {
            const idx = prev.findIndex((x) => x.pi_id === hb.pi_id);
            if (idx < 0) return [...prev, hb];
            const next = [...prev];
            next[idx] = hb;
            return next;
          });
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRealtime("connected");
        else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        )
          setRealtime("disconnected");
      });

    return () => {
      cancelled = true;
      client.removeChannel(channel);
    };
  }, []);

  return { events, firefighters, heartbeats, loading, error, realtime };
}
