# plan.md — BLE 소방관 진출입 감지 시스템

> 최종 갱신: 2026-07-02
> 목적: 소방관 현장 배포용 실내 진출입 감지 시스템 — **사업체 납품 전용 (논문 X)**
> 팀: 조선대 정보통신공학과 — 이건우, 김형준, 김소연, 변재영
> 개발 환경: Antigravity + Claude Code (이 plan.md와 claude.md를 프로젝트 루트에 두고 참조)

---

## 1. 배경 및 핵심 목표
- **대원 안전**: 진입 대원의 진출입 현황 자동 관리, 장기적으로 층별 위치 파악까지 확장
- **관제 통일**: 지휘부-현장 정보 격차 해소, Web 대시보드 (기기 제약 없이 접속)
- **비접촉 필수**: 소방 장갑 착용 시 조작 불가 → 태그 소지만으로 자동 인식
- **태그 폼팩터**: 펜 부착형(현재) 또는 카드형. 스마트폰은 배터리·앱 설치 거부 우려로 배제
- **미퇴장 경보**: 설정 시간(25분) 내 출구 미통과 대원을 대시보드에서 시각적 강조

## 2. 확정 아키텍처 (2026-07-02 확정)
소방관이 비콘 태그 소지 + 문 근처 고정 수신기 2대. **판정은 Pi(엣지), 서버는 Supabase+Vercel.**

```
[비콘 태그 (소방관 소지)]   iBeacon, 500ms(확정), TX -4dBm → -12dBm 예정
        ↓ BLE
[수신기 A] [수신기 B]       nRF52840 ×2, 복도 수평 5m 간격(확정)
        ↓ USB/시리얼
[Raspberry Pi 5]            ★ 판정 알고리즘 실행 (엣지 판정)
  - algorithm.py + 필터
  - 이벤트만 생성 (raw는 로컬 CSV 보관)
  - LTE 단절 시 로컬 큐(SQLite) → 복구 후 재전송
        ↓ LTE 모뎀 (구매 완료) — HTTPS
[Supabase]                  PostgreSQL + Realtime + Auth
  - events, firefighters, sessions, heartbeats 테이블
  - Realtime으로 대시보드에 실시간 push
        ↓ Supabase Realtime 구독
[대시보드 — Vercel 배포]    Next.js 14 + Tailwind + Zustand + shadcn/ui
```

### 확정 사항
| 항목 | 결정 | 근거 |
|------|------|------|
| DB/실시간 | Supabase (PostgreSQL + Realtime) | 상시 서버 불필요, 무료 티어 시작, 관리 최소 |
| 배포 | Vercel (Next.js 프론트) | 서버리스 — MQTT/WebSocket 서버 불가하므로 프론트 전용 |
| 판정 위치 | **Pi 엣지 판정** | LTE 단절에도 판정 지속(안전), 데이터량 최소 |
| 업로드 | **이벤트만** (raw는 Pi 로컬 CSV) | LTE 요금·지연 최소, 무료 티어 보호 |
| 기존 M1 (FastAPI+MQTT+WebSocket) | **운영 배포 안 함** — 로컬 개발·CSV replay 검증 도구로 강등 | 상시 서버 비용·관리 회피 |

## 3. 실험 이력 (완료)
| 실험 | 결과 |
|------|------|
| 송신 주기 (100~1000ms) | **500ms 확정** — 인터벌 올려도 성능차 없어 배터리·비용상 500ms |
| 다중 대원 간섭 (비콘 2개 밀착/보행) | 완료 — 섀도잉·충돌 확인 |
| 출입 방향 판단 (정지/보행/구보) | 피크 시간차 방식 검증, 핑퐁 에러 확인 포함 |
| 수신기 이격 (1/3/5m) | **5m 확정** |
| 본 알고리즘 4세션 (500ms/5m) | 감지율 91.2%, 방향정확도 94.5%, FP 8, Miss 7. 빠른 보행(4초) 85% |

## 4. 알고리즘 현황
- 파라미터: `RSSI_FLOOR=-75`, `MIN_CROSS_SEC=2.0`, `MAX_CROSS_SEC=9.0`, `COOLDOWN_SEC=5.0`, `SWAP_AB=True`
- 파이프라인: Wall_sec offset 보정(median) → SMA(3) → `find_peaks(prominence=7.0)` → 피크 시간차 방향 판정 → COOLDOWN

### FP 원인 및 대책 (우선순위 순)
| # | 원인 | 대책 | 상태 |
|---|------|------|------|
| ① | scan_window < scan_interval → 패킷 손실 35~40% | 펌웨어 `window = interval` → ~12% | 미적용 |
| ② | 배치 (동시 강수신 구간, 벽 반사파) | 문 프레임 양쪽 30cm, 벽 1~2m 이격 | 다음 실험 |
| ③ | TX -4dBm 과다 | -12dBm | 다음 실험 |
| ④ | 3채널 RSSI 편차 | 후보: 37번 단일 채널 — **미확정, 실측 비교 후 결정** | 검토 중 |
| ⑤ | 수신기 시간축 불일치 (최대 741초) | **해결**: 실시간 경로는 두 수신기가 같은 Pi에 USB 연결 → Pi 도착 시각 단일 시계 사용. offline replay만 Wall_sec 보정 유지 | 해결 |
| ⑥ | 개수 기준 SMA 한계 | EMA 또는 칼만 필터 | 미적용 |
- 레퍼런스: PMC "Intelligent Bluetooth Virtual Door System"(2025) — 문 밀착 + Faraday 차폐 + ML로 96.6~97.3%

## 5. 결정 필요 항목 (임의 채택 금지)
1. **채널 전략**: 37번 단일 vs 3채널 유지 — 단일 채널은 편차 제거 이점이 있으나 주파수 다이버시티 상실(페이딩·WiFi 간섭 시 전멸 위험). 실측 A/B 후에만 채택
3. **태그 폼팩터**: 펜 vs 카드 (내구성·배터리 교체 방식)

## 6. 데이터 스키마 (Supabase, 초안)
- `firefighters`: id, name, tag_uuid(비콘 식별자), team, active
- `events`: id(sha256 결정성), firefighter_id, direction(entry/exit), confidence, cross_sec, detected_at, site_id
- `sessions`: 현장(출동) 단위 — site, started_at, ended_at
- `heartbeats`: pi_id, last_seen — **LTE/Pi 생존 감시** (끊기면 대시보드에 "현장 통신 두절" 경고)
- RLS 활성화. Pi는 service key, 대시보드는 anon key + Auth

## 7. 로드맵

### Phase 0 — 클라우드 기반 구축 (진행 중, 2026-07-02)
- [x] pi/ 실시간 판정 패키지 (algorithm/serial/uploader/main/replay)
- [x] supabase/schema.sql
- [ ] Supabase 프로젝트 생성, 스키마(§6) 구축, RLS 설정
- [ ] Pi 업로더: supabase-py insert + 오프라인 큐(SQLite) + 재전송 + heartbeat
- [ ] Next.js 스캐폴드 → Vercel 배포, Supabase Realtime 구독 연결 (기존 M1 프론트 컴포넌트 이식)
- [ ] LTE 모뎀 Pi 연결·회선 개통 테스트 (end-to-end: 비콘 → 대시보드 지연 측정)

### Phase 1 — 신호 품질 개선 (다음 실험 전 필수)
- [ ] 펌웨어 `scan_window = scan_interval` (①)
- [ ] TX -12dBm (③), 배치 변경 (②)
- [ ] 패킷 손실률 단독 측정 (40% → 12% 검증)
- [ ] (선택) 37번 단일 채널 A/B 비교

### Phase 2 — 실험 라운드 2
- 조건: 500ms/5m, -12dBm, 새 배치, 수정 펌웨어. GT는 스톱워치 랩
- [ ] 목표: 감지율 ≥95%, FP ≤2, 빠른 보행 ≥90%
- [ ] 다중 대원 동시 통과 세션 포함 (태그별 독립 판정 검증)
- [ ] raw RSSI 원본 보존

### Phase 3 — 필터 고도화 (Phase 2 데이터로만 튜닝)
- [ ] EMA(시간 기반 α) → 칼만(1D) offline 비교 → 채택. prominence 재튜닝 필수

### Phase 4 — 대시보드 M2 (Vercel)
- [ ] OccupantList (현재 내부 인원, firefighters 연동)
- [ ] EventTable (진출입 로그)
- [ ] AlertPanel (25분 미퇴장) — 프론트 계산 + Supabase pg_cron 백업 (서버리스라 상시 타이머 없음)
- [ ] 통신 두절 경고 (heartbeat 기반)
- [ ] CSV replay: 로컬 M1 도구로 알고리즘 검증 (운영 경로와 완전 분리)

### Phase 5 — 상용화 (M3)
- [ ] 시간 동기화 확정·구현 (결정 항목 2)
- [ ] Faraday 차폐 실험 (안쪽 컵형, 바깥쪽 후면)
- [ ] (조건부) ML 분류기 — 룰 기반 95% 미달 시에만
- [ ] 다중 현장(site) 지원, 지휘통제소 뷰
- [ ] Supabase 유료 티어 검토 (납품 시 SLA)

### Phase 6 — 층별 확장 (장기, 현 범위 아님)
- 층별 경계에 수신기 페어 추가 (동일 판정 로직 재사용), 배터리·화재 내구성 검토

## 8. 참고: 기존 M1 자산 처리
- FastAPI+MQTT+WebSocket 백엔드: 운영 배포 안 함. CSV replay 기반 알고리즘 회귀 검증 도구로 유지
- R6 버그(C1~C4): 운영 경로에서 제외되어 우선순위 하향. replay 도구 정비 시 C1(state 분리)·C2(결정성 event_id)만 반영 — C2는 Supabase events.id에도 동일 원칙 적용
- M1 프론트 컴포넌트(실시간 피드 등): 새 Next.js로 이식

## 9. 납품 기준
- 감지율 ≥97%, 방향정확도 ≥97%, FP 세션당 0~1
- **Miss > FP 우선순위** (내부 잔류 미탐지 = 인명 사고), 둘 다 기준 포함
- LTE 단절 시 이벤트 무손실 (로컬 큐 재전송), 단절 자체를 대시보드에 표시
- 다중 대원 동시 통과 시 대원별 정확 판정
- 비콘 → 대시보드 end-to-end 지연 목표 ≤3초
