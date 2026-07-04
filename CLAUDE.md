# claude.md — BLE 소방관 진출입 감지 시스템 작업 규칙

> 이 파일은 Antigravity의 Claude Code가 이 프로젝트에서 일하는 방식 명세다.
> 기존 claude.md(일반 규칙)가 있다면 그 아래에 이 내용을 추가한다.
> 로드맵·확정/미확정 사항은 plan.md가 단일 소스다.

## 0. 최우선 원칙: 인명 안전 시스템
이 시스템은 소방관의 생명과 직결된다.

1. **Miss(미탐지) 최소화 > FP(오탐) 최소화 > 편의성**. 내부 잔류 소방관을 놓치는 것이 최악의 실패다.
2. FP도 방치 금지 — 유령 이벤트는 경보 신뢰도를 무너뜨려 실제 경보 무시로 이어진다.
3. 검증되지 않은 최적화보다 검증된 보수적 로직. 실험 데이터로 확인 전에는 배포하지 않는다.
4. 안전 관련 트레이드오프(민감도 vs FP 등)는 임의 결정하지 말고 사용자에게 옵션으로 제시.

## 1. 아키텍처 고정 사항 (혼동 방지)
- **확정**: 소방관이 비콘 태그 소지 + 문 근처 고정 수신기 2대(nRF52840). "소방관이 수신기 휴대" 구조는 폐기된 과거 안 — 재제안 금지.
- **확정**: 수신기 복도 수평 5m 간격 (수직 상하단 배치는 폐기), 송신 주기 500ms, 납품 전용(논문 X).
- **확정 스택**: 판정은 **Pi 엣지**, DB/실시간은 **Supabase**(PostgreSQL+Realtime), 프론트는 **Next.js 14 → Vercel**. FastAPI+MQTT+WebSocket(M1)은 운영 배포 안 함 — 로컬 replay 검증 도구.
- **확정 정책**: 서버에는 이벤트만 업로드. raw RSSI는 Pi 로컬 CSV 보관.
- **미확정** (임의 채택 금지, plan.md §5): 37번 단일 채널, 시간 동기화 방식, 태그 폼팩터. 관련 코드는 사용자 확인 후 작성.
- 알고리즘은 다중 대원(다중 태그) 동시 통과 전제 — 태그별 독립 상태 관리.

## 2. 파일 구조
```
project/
├── plan.md / claude.md   # 루트 유지, 변경 시 갱신
├── firmware/             # nRF52840 스캔 펌웨어
├── pi/                   # 엣지: 수집 + 판정 + 업로드
│   ├── algorithm.py      # 판정 로직 (단일 소스)
│   ├── params.py         # 모든 튜닝 파라미터는 여기에만
│   ├── uploader.py       # Supabase insert + 오프라인 큐(SQLite) + heartbeat
│   └── replay/           # CSV replay 회귀 검증 (구 M1 도구)
├── web/                  # Next.js 14 (Vercel 배포)
├── supabase/             # 스키마 마이그레이션, RLS 정책
├── data/
│   ├── raw/              # 실험 원본 CSV — 절대 수정 금지
│   └── processed/
└── experiments/          # 세션별 분석 + 결과 요약
```

## 3. BLE 알고리즘 파라미터 규칙
```python
RSSI_FLOOR    = -75   # 실측 기반. 배치/TX 변경 시 재측정
MIN_CROSS_SEC = 2.0   # 보행속도·5m 간격에 종속
MAX_CROSS_SEC = 9.0
COOLDOWN_SEC  = 5.0   # 꼬리 피크 FP 차단
SWAP_AB       = True  # 배치 바꾸면 반드시 확인
PROMINENCE    = 7.0   # 필터 교체 시 재튜닝 필수
SMA_WINDOW    = 3
```
- **한 번에 하나만 변경**, 4세션 CSV replay로 감지율/방향정확도/FP/Miss 전후 비교.
- 하드웨어 조건(TX, 배치, scan 설정) 변경 시 RSSI 통계가 달라짐 → 전 파라미터 재검증. 구 데이터로 튜닝한 값을 새 조건에 이월 금지.
- 필터 교체(SMA→EMA/칼만) 시 prominence 재튜닝 (부드러운 필터 = 피크 진폭 감소).
- 파라미터 변경 커밋에는 전후 성능 지표 기록.

## 4. 시간축 처리 규칙 (필수)
- 두 수신기는 부팅 시점이 달라 `Elapsed_ms` 기준이 최대 741초 어긋난다. **A/B 비교는 반드시 Wall_sec 기준 offset 보정(median) 후에만** 수행.
- `Elapsed_ms`를 수신기 간 직접 비교하는 코드 금지. 리뷰에서 발견 시 즉시 지적.
- cross_sec, COOLDOWN, 피크 매칭 모두 보정된 시간축 사용. NTP 도입 전까지 보정 코드 제거 금지.

## 5. 실험·검증 규칙
- 모든 알고리즘 변경은 기존 세션 CSV replay로 회귀 검증 후 배포.
- GT(스톱워치 랩) 매칭 기준은 코드에 명시, 임의 변경 금지.
- 성능 보고는 항상 4지표 세트(감지율/방향정확도/FP/Miss). 하나만 좋아진 건 개선이 아니다.
- 빠른 보행(4초 통과)을 최악 케이스 기준으로.

## 6. Supabase·Vercel 규칙
- **키 관리**: Pi만 service_role key, 웹은 anon key + Auth. 키는 .env, 커밋 금지.
- **RLS 항상 활성화**. 새 테이블 생성 시 정책 없이 방치 금지.
- `events.id`는 결정성(sha256: tag+timestamp+direction 기반) — 재전송·재처리 시 중복 insert 방지 (upsert).
- Pi 업로더는 LTE 단절 대비 로컬 큐(SQLite) → 복구 후 순서 보존 재전송. **이벤트 유실은 안전 사고다.**
- heartbeat 테이블로 Pi/LTE 생존 감시 — 대시보드에 "통신 두절" 경고 필수.
- 25분 경보는 DB 데이터 기반(entry 시각) 계산 — 메모리 전용 타이머 금지 (서버리스는 상시 프로세스 없음).
- replay/테스트 데이터는 운영 테이블에 insert 금지 — 별도 스키마 또는 로컬 DB.

## 7. 스킬·MCP 활용 규칙 (Antigravity/Claude Code)
설치된 플러그인: claude-mem, design-council, framer-motion, superpowers, ui-ux-pro-max, frontend-design, impeccable, skill-creator
연결된 MCP: TestSprite, mcp-search(claude-mem), magic, playwright, ruflo, Google Drive

작업별 사용 규칙:

- **대시보드 UI 작업**: ui-ux-pro-max를 주 스킬로. frontend-design/design-council/impeccable과 지침이 충돌하면 ui-ux-pro-max 우선. 관제 화면 특성상 고대비·큰 글씨·상태색(정상/경고/위험) 일관성이 미적 취향보다 우선
- **framer-motion**: 경보(25분 미퇴장, 통신 두절) 강조 애니메이션에 사용. 장식용 과도한 모션 금지 — 관제 화면은 주의 분산 최소화
- **playwright MCP**: 대시보드 실시간 갱신·경보 표시를 실제 렌더링으로 검증 (Realtime 이벤트 주입 → 화면 반영 확인)
- **TestSprite**: web/ E2E 테스트 작성·실행
- **claude-mem**: 세션 간 결정 사항(파라미터 변경 이력, 실험 결과) 기억에 활용
- **superpowers**: 계획 수립·디버깅 워크플로우에 해당 스킬 있으면 사용
- 이벤트 스키마·판정 로직 관련 UI 코드는 반드시 plan.md §6 스키마 기준으로 작성
- 새 스킬·MCP 추가 시 이 목록 갱신

## 8. 커뮤니케이션
- 사용자는 Python에 익숙, Colab 사용. 분석 코드는 Colab에서 바로 실행 가능하게.
- 간결하게. 성능 수치는 표로.
