-- ============================================================
-- schema.sql — Supabase SQL Editor에 통째로 붙여넣고 Run
-- ============================================================

-- 대원 (태그 등록)
create table if not exists firefighters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tag_mac text unique not null,          -- 비콘 MAC (대문자, AA:BB:.. 형식)
  team text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 현장(출동) 세션
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

-- 진출입 이벤트 (id는 Pi가 결정성 uuid5로 생성 → 재전송해도 중복 없음)
create table if not exists events (
  id uuid primary key,
  site_id text not null,
  tag_mac text not null,
  direction text not null check (direction in ('entry','exit')),
  cross_sec real,
  peak_a real,
  peak_b real,
  detected_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists events_site_time on events (site_id, detected_at desc);
create index if not exists events_tag_time on events (tag_mac, detected_at desc);

-- Pi/LTE 생존 감시
create table if not exists heartbeats (
  pi_id text primary key,
  site_id text not null,
  last_seen timestamptz not null,
  queue_depth integer not null default 0
);

-- ── RLS ─────────────────────────────────────────────────────
-- Pi는 service_role key(RLS 우회)로 쓰기. 웹(anon)은 읽기 전용.
alter table firefighters enable row level security;
alter table sessions     enable row level security;
alter table events       enable row level security;
alter table heartbeats   enable row level security;

create policy "anon read firefighters" on firefighters for select using (true);
create policy "anon read sessions"     on sessions     for select using (true);
create policy "anon read events"       on events       for select using (true);
create policy "anon read heartbeats"   on heartbeats   for select using (true);
-- 납품 시에는 using(true)를 Auth 기반 정책으로 교체할 것

-- ── Realtime 활성화 (대시보드 실시간 push) ───────────────────
alter publication supabase_realtime add table events;
alter publication supabase_realtime add table heartbeats;

-- ── 테스트 대원 1명 (본인 비콘 MAC으로 수정) ─────────────────
-- insert into firefighters (name, tag_mac, team)
-- values ('이건우', 'C3:00:00:1A:2B:3C', '1팀');
