# 🚒 BLE 소방관 진출입 감지 — 설치·실행 순서

폴더 구성:

```
fire-demo/
├── plan.md          # 로드맵 (Antigravity 프로젝트 루트에 넣기)
├── CLAUDE.md        # Claude Code 작업 규칙 (〃)
├── supabase/schema.sql
└── pi/              # 라즈베리파이에 통째로 복사
    ├── main.py          # 실행 진입점
    ├── algorithm.py     # 실시간 판정 (노트북 검증 로직 이식)
    ├── params.py        # 모든 튜닝 파라미터
    ├── serial_reader.py # nRF52840 수집 + raw 보존
    ├── uploader.py      # Supabase 업로드 + 오프라인 큐 + heartbeat
    ├── replay.py        # 기존 CSV로 회귀 검증
    ├── requirements.txt
    └── .env.example
```

## 1단계 — Supabase (컴퓨터에서, 5분)
1. supabase.com → 프로젝트 → SQL Editor
2. `supabase/schema.sql` 전체 붙여넣고 **Run**
3. Table Editor → firefighters → 대원 1명 insert (name, tag_mac=비콘 MAC 대문자, active=true)
4. Settings > API에서 `Project URL`, `service_role key` 확보 (anon key는 웹용)

## 2단계 — 라즈베리파이 (15분)
```bash
# pi/ 폴더를 Pi로 복사 후
cd pi
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# 수신기 2대 USB 연결 후 포트 확인
ls /dev/serial/by-id/
# → 나온 경로 2개를 .env에 기입 (어느 쪽이 A(바깥)/B(안)인지 물리적으로 확인!)

cp .env.example .env && nano .env   # URL, service key, 포트 입력
python3 main.py
```
- 정상이면 로그에 `[A] 연결됨`, `[B] 연결됨` 후 비콘 통과 시 `>>> 이벤트: ... ENTRY cross=3.2s` 출력
- Supabase Table Editor → events에 행이 쌓이는지 확인
- 네트워크는 Wi-Fi로 시작. LTE 모뎀은 확정되면 꽂기만 하면 됨 (코드 변경 없음)

### A/B 방향 확인법
바깥→안으로 걸어 들어갔는데 `EXIT`로 찍히면 `.env`의 A/B 포트를 서로 바꾸거나 `params.py`의 `SWAP_AB`를 토글.

### 기존 CSV로 검증 (권장, Pi 또는 Colab)
```bash
python3 replay.py ble_scan_A_500ms.csv ble_scan_B_500ms.csv
# GT 채점까지: --gt gt.csv  (형식: start,end,direction 줄들)
```
알고리즘 파라미터를 바꿀 때는 반드시 replay 전후 4지표 비교.

## 3단계 — Antigravity (웹 대시보드)
1. GitHub repo에 이 폴더 전체 push (plan.md, CLAUDE.md 루트 유지)
2. Antigravity에서 repo 열고 첫 프롬프트:

> plan.md와 CLAUDE.md를 읽어. pi/와 supabase/는 완성돼 있으니 수정하지 말고, web/ 폴더에 Next.js 14 대시보드를 만들어줘. 요구사항: ① Supabase Realtime으로 events 구독 → 실시간 진출입 피드 ② OccupantList: entry−exit 계산으로 현재 내부 인원 표시 ③ AlertPanel: 진입 후 25분 초과 대원 강조 ④ heartbeats.last_seen이 60초 이상 오래되면 "현장 통신 두절" 배너 ⑤ 키는 NEXT_PUBLIC_SUPABASE_URL/ANON_KEY 환경변수. UI는 ui-ux-pro-max 스킬 적용, 관제용 고대비 다크 테마.

3. 로컬 확인 후 Vercel에 배포 (환경변수 2개 등록)

## 문제 해결
- **시리얼에 아무것도 안 뜸**: 펌웨어가 스캔 결과를 UART로 출력하는지 확인. `cat /dev/serial/by-id/...` 로 raw 확인
- **파싱 실패 (raw_line만 기록됨)**: 펌웨어 출력 라인 샘플을 갖고 `serial_reader.py`의 `parse_line` 정규식 조정
- **이벤트가 Supabase에 안 감**: 로그의 "업로드 실패" 확인. 큐(queue.db)에 보존되므로 유실은 없음 — 네트워크 복구 시 자동 재전송
