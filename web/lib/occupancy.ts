import type { FireEvent, Firefighter, Occupant } from "./types";

// 25분 미퇴장 경보 — DB의 entry detected_at 기준 계산 (메모리 전용 타이머 금지)
export const ALERT_LIMIT_MIN = 25;
export const ALERT_LIMIT_MS = ALERT_LIMIT_MIN * 60 * 1000;
// 경보 전 주의 단계 (표시 색상용)
export const WARN_LIMIT_MS = 20 * 60 * 1000;

// heartbeats.last_seen 지연 2단계 — 60초~180초 '통신 지연'(KPI만), 180초 초과 '통신 두절'(점멸 배너)
export const HEARTBEAT_STALE_MS = 60 * 1000;
export const HEARTBEAT_LOST_MS = 180 * 1000;

/**
 * 태그별 최신 이벤트가 entry면 내부 인원으로 판정.
 * 다중 대원 동시 활동 전제 — 태그(tag_mac) 단위로 독립 계산.
 * 이벤트 순서가 뒤섞여 도착해도(LTE 복구 재전송) detected_at으로 최신을 고른다.
 */
export function computeOccupants(
  events: FireEvent[],
  firefighters: Firefighter[],
): Occupant[] {
  const latest = new Map<string, FireEvent>();
  for (const ev of events) {
    const cur = latest.get(ev.tag_mac);
    if (!cur || Date.parse(ev.detected_at) > Date.parse(cur.detected_at)) {
      latest.set(ev.tag_mac, ev);
    }
  }

  const byMac = new Map(firefighters.map((f) => [f.tag_mac, f]));
  const occupants: Occupant[] = [];
  for (const [mac, ev] of latest) {
    if (ev.direction !== "entry") continue;
    const ff = byMac.get(mac);
    occupants.push({
      tagMac: mac,
      name: ff?.name ?? mac,
      team: ff?.team ?? null,
      registered: ff != null,
      enteredAt: Date.parse(ev.detected_at),
    });
  }
  // 가장 오래 내부에 있는 대원이 위로
  return occupants.sort((a, b) => a.enteredAt - b.enteredAt);
}

export type OccupantStatus = "ok" | "warn" | "danger";

export function occupantStatus(elapsedMs: number): OccupantStatus {
  if (elapsedMs >= ALERT_LIMIT_MS) return "danger";
  if (elapsedMs >= WARN_LIMIT_MS) return "warn";
  return "ok";
}
