-- v2: 판정 방법·신뢰도 컬럼 추가 (Supabase SQL Editor에서 실행)
alter table events add column if not exists method text default 'peak';
alter table events add column if not exists confidence real default 0.8;
