// supabase/schema.sql 및 plan.md §6 스키마 기준
export interface Firefighter {
  id: string;
  name: string;
  tag_mac: string;
  team: string | null;
  active: boolean;
  created_at: string;
}

export interface FireEvent {
  id: string;
  site_id: string;
  tag_mac: string;
  direction: "entry" | "exit";
  cross_sec: number | null;
  peak_a: number | null;
  peak_b: number | null;
  detected_at: string;
  created_at: string;
}

export interface Heartbeat {
  pi_id: string;
  site_id: string;
  last_seen: string;
  queue_depth: number;
}

// entry 후 exit 이벤트가 없는 대원 = 현재 내부 인원
export interface Occupant {
  tagMac: string;
  name: string;
  team: string | null;
  registered: boolean; // firefighters에 등록된 태그인지 (false면 name = tag_mac)
  enteredAt: number; // epoch ms (events.detected_at)
}
