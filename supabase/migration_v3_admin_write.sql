-- v3: /admin 관리 페이지 — 로그인(authenticated) 사용자의 firefighters 추가/수정 허용
-- (Supabase SQL Editor에서 실행. 조회는 기존 select 정책(public)으로 이미 허용됨)
--
-- 주의: 이 프로젝트는 RLS 정책만 만들고 테이블 레벨 GRANT를 빠뜨려
-- "permission denied"가 났던 이력이 있음 → 정책과 GRANT를 반드시 함께 적용.

grant insert, update on table public.firefighters to authenticated;

drop policy if exists "authenticated insert firefighters" on public.firefighters;
create policy "authenticated insert firefighters"
  on public.firefighters for insert to authenticated
  with check (true);

drop policy if exists "authenticated update firefighters" on public.firefighters;
create policy "authenticated update firefighters"
  on public.firefighters for update to authenticated
  using (true) with check (true);
