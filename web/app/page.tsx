"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Flame,
  RadioTower,
  UserCog,
  Users,
} from "lucide-react";
import { AlertPanel } from "@/components/AlertPanel";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { EventFeed } from "@/components/EventFeed";
import { MuteToggle } from "@/components/MuteToggle";
import { OccupantList } from "@/components/OccupantList";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAlertSound } from "@/hooks/useAlertSound";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useNow } from "@/hooks/useNow";
import {
  ALERT_LIMIT_MS,
  computeOccupants,
  HEARTBEAT_LOST_MS,
  HEARTBEAT_STALE_MS,
} from "@/lib/occupancy";
import { supabaseConfigured } from "@/lib/supabase";

export default function Page() {
  if (!supabaseConfigured) return <SetupNotice />;
  return <Dashboard />;
}

function Dashboard() {
  const { events, firefighters, heartbeats, loading, error, realtime } =
    useDashboardData();
  const now = useNow(1000);

  const occupants = useMemo(
    () => computeOccupants(events, firefighters),
    [events, firefighters],
  );
  const overdue =
    now == null
      ? []
      : occupants.filter((o) => now - o.enteredAt >= ALERT_LIMIT_MS);

  // 미퇴장 경보음 — 음소거 상태는 localStorage에 유지
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    try {
      setMuted(localStorage.getItem("alert-muted") === "1");
    } catch {
      // localStorage 차단 환경 — 기본값(소리 켬) 유지
    }
  }, []);
  const toggleMuted = () =>
    setMuted((m) => {
      const next = !m;
      try {
        localStorage.setItem("alert-muted", next ? "1" : "0");
      } catch {
        // 저장 실패해도 세션 내 토글은 동작
      }
      return next;
    });
  useAlertSound(
    overdue.map((o) => o.tagMac),
    muted,
  );

  // 가장 오래 침묵한 Pi 기준(보수적) — 하나라도 끊기면 그 시점 이후 이벤트가 누락됐을 수 있다
  const oldestSeen =
    heartbeats.length === 0
      ? null
      : Math.min(...heartbeats.map((hb) => Date.parse(hb.last_seen)));
  const staleness =
    now == null || oldestSeen == null ? null : now - oldestSeen;
  const commStatus: "ok" | "delayed" | "lost" | "none" =
    oldestSeen == null
      ? "none"
      : staleness == null
        ? "ok"
        : staleness >= HEARTBEAT_LOST_MS
          ? "lost"
          : staleness >= HEARTBEAT_STALE_MS
            ? "delayed"
            : "ok";
  // 지연/두절이면 내부 인원·경보 카드에 "마지막 수신 기준" 스탬프 + 흐림 처리
  const staleSince =
    commStatus === "delayed" || commStatus === "lost" ? oldestSeen : null;

  return (
    <div className="min-h-dvh">
      <ConnectionBanner heartbeats={heartbeats} now={now} />

      <header className="border-b border-edge bg-surface">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Flame className="h-7 w-7 shrink-0 text-danger" aria-hidden />
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold leading-tight">
                소방관 진출입 관제
              </h1>
              <p className="truncate text-sm font-medium text-muted">
                BLE 진출입 감지 · 실시간
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <p
              className="hidden text-sm font-medium text-muted sm:flex sm:items-center sm:gap-2"
              aria-label={`서버 연결 ${
                realtime === "connected" ? "정상" : realtime === "connecting" ? "연결 중" : "끊김"
              }`}
            >
              <span
                aria-hidden
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  realtime === "connected"
                    ? "bg-ok"
                    : realtime === "connecting"
                      ? "bg-warn"
                      : "bg-danger"
                }`}
              />
              {realtime === "connected"
                ? "서버 연결됨"
                : realtime === "connecting"
                  ? "연결 중"
                  : "서버 끊김"}
            </p>
            <p className="text-lg font-bold tabular-nums">
              {now == null
                ? "--:--:--"
                : new Date(now).toLocaleTimeString("ko-KR", { hour12: false })}
            </p>
            <MuteToggle muted={muted} onToggle={toggleMuted} />
            <Link
              href="/admin"
              aria-label="대원 관리 페이지"
              title="대원 관리"
              className="rounded-lg border border-edge p-2 hover:bg-surface-2"
            >
              <UserCog className="h-5 w-5" aria-hidden />
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-4 lg:px-6 lg:py-6">
        {error && (
          <div
            role="alert"
            className="rounded-lg border-2 border-danger bg-danger-bg px-4 py-3 text-base font-medium"
          >
            데이터 로드 실패: {error} — 새로고침하거나 Supabase 상태를
            확인하세요.
          </div>
        )}

        {/* 상태 요약 */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <StatTile
            icon={<Users className="h-6 w-6" aria-hidden />}
            label="내부 인원"
            value={loading ? "–" : String(occupants.length)}
            tone={occupants.length > 0 ? "info" : "ok"}
          />
          <StatTile
            icon={<AlertTriangle className="h-6 w-6" aria-hidden />}
            label="미퇴장 경보"
            value={loading ? "–" : String(overdue.length)}
            tone={overdue.length > 0 ? "danger" : "ok"}
          />
          <StatTile
            icon={<Activity className="h-6 w-6" aria-hidden />}
            label="24시간 이벤트"
            value={loading ? "–" : String(events.length)}
            tone="neutral"
          />
          <StatTile
            icon={<RadioTower className="h-6 w-6" aria-hidden />}
            label="현장 통신"
            value={
              commStatus === "none"
                ? "미수신"
                : commStatus === "lost"
                  ? "두절"
                  : commStatus === "delayed"
                    ? "지연"
                    : "정상"
            }
            tone={
              commStatus === "none"
                ? "neutral"
                : commStatus === "lost"
                  ? "danger"
                  : commStatus === "delayed"
                    ? "warn"
                    : "ok"
            }
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <OccupantList occupants={occupants} now={now} staleSince={staleSince} />
          </div>
          <div className="space-y-4">
            <AlertPanel overdue={overdue} now={now} staleSince={staleSince} />
            <EventFeed events={events} firefighters={firefighters} />
          </div>
        </div>
      </main>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "ok" | "warn" | "danger" | "info" | "neutral";
}) {
  const toneText =
    tone === "ok"
      ? "text-ok"
      : tone === "warn"
        ? "text-warn"
        : tone === "danger"
          ? "text-danger"
          : tone === "info"
            ? "text-info"
            : "text-fg";
  return (
    <div className="rounded-xl border border-edge bg-surface p-4">
      <div className={`flex items-center gap-2 ${toneText}`}>
        {icon}
        <p className="text-sm font-bold text-muted">{label}</p>
      </div>
      <p className={`mt-2 text-3xl font-bold tabular-nums ${toneText}`}>
        {value}
      </p>
    </div>
  );
}

function SetupNotice() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-lg rounded-xl border border-edge bg-surface p-6">
        <h1 className="text-xl font-bold">Supabase 환경변수 필요</h1>
        <p className="mt-3 text-base leading-relaxed text-muted">
          <code className="rounded bg-surface-2 px-1.5 py-0.5 text-sm">
            web/.env.local
          </code>{" "}
          파일에 아래 두 값을 설정한 뒤 다시 실행하세요 (
          <code className="rounded bg-surface-2 px-1.5 py-0.5 text-sm">
            .env.example
          </code>{" "}
          참고). anon key만 사용하고 service_role 키는 절대 넣지 마세요.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-surface-2 p-4 text-sm leading-relaxed">
          {`NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...`}
        </pre>
      </div>
    </div>
  );
}
