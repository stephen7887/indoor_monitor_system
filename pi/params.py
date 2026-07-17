# ============================================================
# params.py — 모든 튜닝 파라미터의 단일 소스
# 규칙(CLAUDE.md §3): 한 번에 하나만 변경, replay로 전후 비교 후 적용
# 기본값은 소방데모.ipynb에서 검증된 값 (500ms / 5m 기준)
# ============================================================

# ── 배치 프로파일 ────────────────────────────────────────────
# 2026-07-14 실측(강의실 개방공간·폴 1.2m)에서 홀수통과 튜닝→짝수 검증 완료.
# 배치를 바꾸면 반드시 replay로 재검증 후 프로파일 전환할 것.
PROFILES = {
    # 검증 성적: 감지 93.8% / 방향 97.8% / FP 25 (SMA 기준)
    "gate_1m2_open": dict(RSSI_FLOOR=-78, MIN_CROSS_SEC=0.4, MAX_CROSS_SEC=9.0,
                          DIFF_STABLE_SEC=2.5, FILTER_MODE="sma"),
    # 칼만 대안: 감지 95.9% / 방향 96.8% / FP 30 — Miss 우선 현장용
    "gate_1m2_open_kalman": dict(RSSI_FLOOR=-78, MIN_CROSS_SEC=0.4, MAX_CROSS_SEC=9.0,
                          DIFF_STABLE_SEC=2.5, FILTER_MODE="kalman",
                          KALMAN_Q=8.0, KALMAN_R=4.0),
    # 문(벽) 배치 — 2026-07-16 실측 튜닝. 방향 98.5%, 칼만 확정
    "door_1m2": dict(RSSI_FLOOR=-78, MIN_CROSS_SEC=0.4, MAX_CROSS_SEC=9.0,
                     DIFF_STABLE_SEC=2.5, FILTER_MODE="kalman",
                     KALMAN_Q=8.0, KALMAN_R=4.0, EPISODE_QUIET_SEC=2.0,
                     COOLDOWN_SEC=3.0, DIFF_HYST_DB=5.0),
    # 구형 복도 5m 배치 (노트북 검증값)
    "corridor_5m": dict(RSSI_FLOOR=-80, MIN_CROSS_SEC=2.0, MAX_CROSS_SEC=9.0,
                        DIFF_STABLE_SEC=1.5, FILTER_MODE="sma"),
}
ACTIVE_PROFILE = "door_1m2"  # 문 배치 기준. 개방공간이면 "gate_1m2_open"

# ── 판정 알고리즘 (기본값 — 프로파일이 덮어씀) ───────────────
RSSI_FLOOR      = -80    # 노이즈 하한선. FP 많으면 -75로 (노트북 주석 참조)
MIN_CROSS_SEC   = 2.0    # A-B 피크 최소 시간차
MAX_CROSS_SEC   = 9.0    # A-B 피크 최대 시간차
COOLDOWN_SEC    = 5.0    # 이벤트 후 불응기 (꼬리 피크 FP 차단)
SWAP_AB         = False  # True = 수신기 A가 안쪽. 배치 바꾸면 반드시 확인!
SMA_WINDOW      = 3      # 이동평균 창 (500ms 기준. 300ms→4, 100ms→6)
PROMINENCE      = 1.0    # find_peaks prominence (노트북 검증값)

# ── 실시간 에피소드 분할 (스트리밍 전용, 신규) ────────────────
# "에피소드" = 태그가 감지 구간에 들어와서 나갈 때까지의 한 덩어리.
# 에피소드가 끝나면 그 구간만 잘라서 노트북과 동일한 피크 분석을 수행.
EPISODE_START_MARGIN = 3.0   # FLOOR + 3dB 이상이어야 에피소드 시작 (히스테리시스)
EPISODE_QUIET_SEC    = 2.5   # 양쪽 모두 이 시간 동안 조용하면 에피소드 종료→판정
EPISODE_MAX_SEC      = 25.0  # 강제 종료 상한 (교차점에 서 있는 경우 대비)
EPISODE_PREROLL_SEC  = 3.0   # 에피소드 시작 전 버퍼 포함 구간
BUFFER_KEEP_SEC      = 40.0  # 태그별 샘플 버퍼 보관 시간

# ── 판정 방법 (v2, 2026-07-02 문헌조사 반영) ─────────────────
# "peak"     : 피크 시간차 (노트북 검증 로직) — 이벤트 기반
# "diff"     : 안/밖 차분 상태머신 (IBVD 논문 계열) — 상태 기반.
#              구보(빠른 통과)·패킷손실에 강하고, Miss 시 자가복구됨
# "ensemble" : 둘 다 실행 + 중복 제거. Miss 최소화 원칙에 따라 기본값
METHOD = "ensemble"

# diff 방식 파라미터
DIFF_HYST_DB        = 5.0   # |안쪽−바깥쪽| 이 값 초과해야 구역 인정 (히스테리시스)
DIFF_STABLE_SEC     = 1.5   # 같은 구역이 이 시간 유지돼야 상태 전이 확정
DIFF_PAIR_MAX_AGE   = 2.0   # A/B 최신 샘플 시간차 허용치
ENSEMBLE_DEDUPE_SEC = 10.0  # 같은 태그·같은 방향 이벤트 중복 제거 창
DIFF_BOTH_MARGIN_DB = 5.0   # 약한 쪽도 FLOOR−5 이상이어야 구역 판정 (꼬리 FP 차단)
DIFF_STATE_TTL_SEC  = 20.0  # 상태 미확인이 이 시간을 넘으면 전이 시 이벤트 없이 재정렬

# ── 정지 오탐(핑퐁 FP) 가드 ──────────────────────────────────
# 진짜 통과는 피크 직전에 신호가 바닥에서 크게 상승한다.
# 교차점에 서 있는 사람의 평탄한 노이즈 피크는 상승폭이 작아 기각.
MERGE_GAP_SEC = 6.0   # 미확정 에피소드 병합 허용 간격
RISE_GUARD_DB = 6.0   # 피크 − (피크 이전 최솟값) 최소 요구치. 0이면 비활성

# ── 필터 선택 (기본 SMA = 검증값. EMA는 실험용 — replay 비교 후에만 채택) ──
FILTER_MODE     = "sma"      # "sma" | "ema" | "kalman"
KALMAN_Q        = 4.0        # 프로세스 노이즈 (dB^2/s) — 클수록 반응 빠름
KALMAN_R        = 6.0        # 측정 노이즈 (dB^2) — 클수록 부드러움
KALMAN_P0       = 10.0
EMA_TAU_SEC     = 1.0        # ema일 때 시간상수 (시간 기반 α = 1-exp(-dt/tau))

# ── 업로더 ───────────────────────────────────────────────────
HEARTBEAT_SEC   = 15.0       # heartbeat 전송 주기
UPLOAD_RETRY_SEC = 5.0       # 전송 실패 시 재시도 간격
QUEUE_DB_PATH   = "queue.db" # 오프라인 큐 (SQLite)

# ── 태그 화이트리스트 ────────────────────────────────────────
# 부팅 시 Supabase firefighters 테이블에서 불러오고, 실패 시 이 목록 사용.
# 비어 있으면 모든 iBeacon MAC 허용 (실험 편의용 — 운영에서는 반드시 등록제)
FALLBACK_TAG_MACS: list[str] = [
    # "C3:00:00:1A:2B:3C",
]

# ── 시리얼 ───────────────────────────────────────────────────
SERIAL_BAUD     = 115200
# 포트는 .env 에서 지정 (부팅마다 ttyACM0/1이 바뀔 수 있으므로 /dev/serial/by-id/ 경로 권장)

# ── 프로파일 적용 (파일 맨 끝에서 실행) ──────────────────────
for _k, _v in PROFILES.get(ACTIVE_PROFILE, {}).items():
    globals()[_k] = _v
