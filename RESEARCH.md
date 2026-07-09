# RESEARCH.md — 알고리즘 개선 문헌조사 및 v2 설계 (2026-07-02)

## 1. 조사 결론 요약

기존 방식(피크 시간차)은 학계·특허에서 검증된 방법이 맞지만, **단독으로 쓰기엔 구조적 약점 2개**가 있고, 문헌은 다른 축의 방법을 함께 쓴다:

| 방법 | 원리 | 강점 | 약점 |
|------|------|------|------|
| 피크 시간차 (현행, RFID 게이트 계열) | A/B 최강 피크의 선후 | 방향이 명확, FP 낮음 | ① 빠른 통과 시 시간차<한계값 ② 패킷손실에 취약 ③ 이벤트 놓치면 인원수 영구 오염 |
| 차분 상태머신 (특허 US10667107, IBVD 계열) | 안쪽−바깥쪽 RSSI 차이의 부호로 "현재 어느 쪽인지" 상태 추적, 상태 전이 = 이벤트 | 속도 무관, 패킷손실에 강함, **놓쳐도 다음 관측에서 자가복구** | 히스테리시스 설계 필요, 문 근처 배회 시 지연 |
| ML (IBVD: LSTM/GRU, 96.6~97.3%) | raw RSSI 2채널 시계열 분류 | 최고 정확도 | 라벨링된 대량 데이터 필요(논문: 48시나리오×5회=240세트), 현장마다 재학습 부담 |

핵심 인용 (IBVD, Sensors 2025): 수신 노드 2개를 **문 양쪽에 최대한 가깝게** 설치하고 Faraday 차폐(안쪽: 컵형, 바깥쪽: 후면 평면)로 안/밖 신호 대비를 만든 뒤, "진입 시 안쪽 노드가 강해지고 바깥 노드가 약해지는" 시계열 패턴을 분류. 필터는 이동평균 사용. 오류는 대부분 "전이 시점의 약간의 지연"으로 나타남.

## 2. 우리 시스템 v2 설계 결정

**앙상블 (peak + diff) 채택, 기본값 `METHOD="ensemble"`**

- peak: 검증된 기존 로직 유지 (에피소드 방식으로 실시간화)
- diff: 안쪽−바깥쪽 차분 + 히스테리시스(5dB) + 안정시간(1.5s) 상태머신 신규 구현
- 중복 제거: 같은 태그·방향 이벤트 10초 창 내 1회만. 방향 충돌 시 먼저 확정된 쪽 우선
- 상태 TTL(20s): 오래 미관측 후 반대편 출현 시 이벤트 없이 상태만 재정렬 (유령 이벤트 방지, 자가복구는 유지)
- 이벤트에 `method`/`confidence` 필드 추가 (migration_v2.sql)

### 합성 벤치마크 (시드 5개, 통과 225회, 패킷손실 25~40%)

| 방법 | 전체 감지 | 전력질주(2초 통과) | 정지/서성임/2인 FP |
|------|----------|------------------|------------------|
| peak | 81.8% | 5/30 | 0 |
| diff | 89.3% | 22/30 | 0 |
| **ensemble** | **96.4%** | **23/30** | **0** |

⚠️ 합성 데이터 결과다. **실제 CSV로 `replay.py --method peak|diff|ensemble` 3종 비교가 최종 판정.** (A/B 페어 CSV 확보 필요)

### 왜 peak이 전력질주를 놓치는가 (구조적)
피크 시간차 ≈ 수신기 간격 ÷ 속도. 5m 간격 기준:
보행 1.4m/s → 3.6s ✓ / 구보 2.0m/s → 2.5s ✓ / 전력질주 3.5m/s → **1.4s < MIN_CROSS_SEC(2.0) 기각**.
세션3(빠른 보행)에서 감지율 85%로 떨어진 실측과 일치. 소방관은 뛴다 — diff 방식이 이 구멍을 메운다.

## 3. "5m가 최적인가"에 대한 답

**"방법에 따라 다르다"가 정답이며, 5m 실험은 peak 방식에서만 유효했다.**

- peak 방식: 간격이 좁으면 피크 겹침, 넓으면 페어링 약화 → 시간차 관점에서 5m는 합리적. 단, 위 계산대로 **뛰는 사람은 5m에서도 구조적으로 놓친다** (간격을 8m로 벌리면 해결되지만 신호 페어링이 약해짐 — 트레이드오프)
- diff/IBVD 방식: 간격이 아니라 **안/밖 대비**가 성능을 결정 → 문 양쪽 밀착 + 차폐가 정석. 간격 5m도 동작하지만 최적이 아닐 수 있음
- 결론: 라운드 2 실험에서 **[5m 수평] vs [문 양쪽 밀착+차폐]** 두 배치를 직접 비교한다 (EXPERIMENT2.md)

## 4. 필터에 대한 판단
문헌상 칼만이 SMA보다 분산 억제 우수(위치오차 ~50% 감소 보고). 단, 우리 병목은 필터가 아니라 ①패킷손실(펌웨어) ②판정 방법(v2로 해결)이다. 칼만은 라운드2 데이터 확보 후 replay로 SMA/EMA/칼만 3종 비교하여 결정 — 지금 서두를 이유 없음.

## 5. 남은 리스크
- diff 방식의 히스테리시스(5dB)·안정시간(1.5s)은 합성 기준값 — 실측 재튜닝 필요
- 문 근처 장시간 배회 시 diff 상태 전이 지연 가능 (경계 근처 |차분|<5dB이면 판정 보류가 설계 의도)
- ML(LSTM)은 룰 기반이 실측 95% 미달일 때만 착수 (라벨 데이터 240세트 규모 필요)

## 참고 자료
- [Occupancy Monitoring Using BLE Beacons: Intelligent Bluetooth Virtual Door System (Sensors 2025)](https://www.mdpi.com/1424-8220/25/9/2638)
- [미국 특허 US10667107: BLE 비콘 진출입 모니터링 (RSSI 상대 변화 기반)](https://patents.google.com/patent/AU2018222950B2/en)
- [Tag Movement Direction Estimation Methods in an RFID Gate System](https://www.intechopen.com/books/current-trends-and-challenges-in-rfid/tag-movement-direction-estimation-methods-in-an-rfid-gate-system)
- [Kalman-Based Fusion BLE Indoor Localization (Sensors 2017)](https://www.mdpi.com/1424-8220/17/5/951)
- [Kalman filtering for RSSI-based localization](https://www.researchgate.net/publication/283488138_Kalman_filtering_for_RSSI_based_localization_system_in_wireless_sensor_networks)
