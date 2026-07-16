import type { FireEvent, Firefighter, Occupant } from "./types";

// 25분 미퇴장 경보 — DB의 entry detected_at 기준 계산 (메모리 전용 타이머 금지)
export const ALERT_LIMIT_MIN = 25;
export const ALERT_LIMIT_MS = ALERT_LIMIT_MIN * 60 * 1000;
// 경보 전 주의 단계 (표시 색상용)
export const WARN_LIMIT_MS = 20 * 60 * 1000;

// heartbeats.last_seen 지연 2단계 — 60초~180초 '통신 지연'(KPI만), 180초 초과 '통신 두절'(점멸 배너)
export const HEARTBEAT_STALE_MS = 60 * 1000;
export const HEARTBEAT_LOST_MS = 180 * 1000;

// 이 값 미만이면 "추정" 이벤트 — 표시만 구분하고 내부 인원 계산에는 동일하게 포함(Miss 방지)
export const CONFIDENCE_ESTIMATED = 0.5;

/** confidence null(구버전 이벤트)은 확정으로 취급 — DB default 0.8 기준 */
export function isEstimated(ev: FireEvent): boolean {
  return ev.confidence != null && ev.confidence < CONFIDENCE_ESTIMATED;
}

/** detected_at 오름차순 정렬 — 뒤섞여 도착한 이벤트(LTE 복구 재전송)도 시간순 재생 */
function sortChrono(events: FireEvent[]): FireEvent[] {
  return [...events].sort(
    (a, b) => Date.parse(a.detected_at) - Date.parse(b.detected_at),
  );
}

/**
 * 태그별 상태머신 재생으로 중복 이벤트 판별.
 * 이미 '내부' 상태인 태그의 entry, 이미 '외부'(미관측 포함) 상태인 태그의 exit는
 * 상태를 바꾸지 않는 중복(no-op) — 내부 인원 계산에서 무시하고 피드에는 회색 표시.
 */
export function computeDuplicateEventIds(events: FireEvent[]): Set<string> {
  const inside = new Set<string>(); // 내부 상태인 tag_mac
  const dup = new Set<string>();
  for (const ev of sortChrono(events)) {
    if (ev.direction === "entry") {
      if (inside.has(ev.tag_mac)) dup.add(ev.id);
      else inside.add(ev.tag_mac);
    } else {
      if (!inside.has(ev.tag_mac)) dup.add(ev.id);
      else inside.delete(ev.tag_mac);
    }
  }
  return dup;
}

/**
 * 태그별 상태머신 재생 — 최종 '내부' 상태인 태그가 내부 인원.
 * 다중 대원 동시 활동 전제 — 태그(tag_mac) 단위로 독립 계산.
 * 중복 entry는 상태를 덮어쓰지 않으므로 enteredAt은 최초 유효 entry 기준
 * (경과 시간이 길게 잡혀 25분 경보가 빨라지는 안전 방향).
 */
export function computeOccupants(
  events: FireEvent[],
  firefighters: Firefighter[],
): Occupant[] {
  // tag_mac → 유효 entry 이벤트 (존재 = 내부 상태)
  const entryEv = new Map<string, FireEvent>();
  for (const ev of sortChrono(events)) {
    if (ev.direction === "entry") {
      if (!entryEv.has(ev.tag_mac)) entryEv.set(ev.tag_mac, ev);
    } else {
      entryEv.delete(ev.tag_mac); // 외부 상태의 exit는 delete가 곧 no-op
    }
  }

  const byMac = new Map(firefighters.map((f) => [f.tag_mac, f]));
  const occupants: Occupant[] = [];
  for (const [mac, ev] of entryEv) {
    const ff = byMac.get(mac);
    occupants.push({
      tagMac: mac,
      name: ff?.name ?? mac,
      team: ff?.team ?? null,
      registered: ff != null,
      enteredAt: Date.parse(ev.detected_at),
      estimated: isEstimated(ev),
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
