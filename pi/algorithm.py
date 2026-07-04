# ============================================================
# algorithm.py — 실시간 진출입 판정 (단일 소스)
#
# 설계 원칙:
#  1. 판정 코어는 소방데모.ipynb에서 검증된 로직 그대로
#     (SMA → find_peaks(prominence) → A/B 최강 피크 시간차 → 방향)
#  2. 실시간화는 "에피소드 분할"로 해결:
#     태그가 감지 구간에 들어오면 버퍼링 시작, 조용해지면 그 구간만
#     잘라서 오프라인과 동일한 배치 분석 → 검증된 동작 보존
#  3. 시간축: 두 수신기가 같은 Pi에 연결되므로 "Pi 도착 시각" 하나로
#     통일 → Elapsed_ms offset 보정 문제 원천 제거
#  4. 다중 대원: 모든 상태를 태그(MAC)별로 독립 관리
#
# 안전 원칙(CLAUDE.md §0): Miss 최소화 > FP 최소화.
#  - 페어링 실패(한쪽 수신기만 피크) 에피소드는 이벤트를 내지 않되
#    unpaired 로그를 남겨 사후 분석 가능하게 한다.
# ============================================================
from __future__ import annotations

import math
import uuid
from collections import deque
from dataclasses import dataclass, field

import numpy as np
from scipy.signal import find_peaks

import params as P

_EVENT_NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")


@dataclass
class Sample:
    t: float          # Pi 기준 시각 (time.time())
    rssi: float       # raw RSSI
    filtered: float   # 필터 적용 값


@dataclass
class Event:
    event_id: str
    tag_mac: str
    direction: str        # "entry" | "exit"
    cross_sec: float
    peak_a: float         # A 최강 피크 RSSI
    peak_b: float
    detected_at: float    # 이벤트 중심 시각 (epoch)
    site_id: str


@dataclass
class _TagState:
    buf: dict = field(default_factory=lambda: {"A": deque(), "B": deque()})
    episode_active: bool = False
    episode_start: float = 0.0
    last_above: float = 0.0        # 마지막으로 FLOOR 위였던 시각 (A/B 통합)
    refractory_until: float = 0.0  # COOLDOWN 불응기


class Detector:
    """수신기 A/B 패킷을 feed() 하면 확정된 Event 리스트를 돌려준다."""

    def __init__(self, site_id: str, allowed_macs: set[str] | None = None,
                 on_unpaired=None):
        self.site_id = site_id
        self.allowed = {m.upper() for m in allowed_macs} if allowed_macs else None
        self.tags: dict[str, _TagState] = {}
        self.on_unpaired = on_unpaired  # 진단 콜백(선택)

    # ── 입력 ────────────────────────────────────────────────
    def feed(self, receiver: str, mac: str, rssi: float, t: float) -> list[Event]:
        """receiver: 'A'|'B'. 반환: 이번 호출로 확정된 이벤트들."""
        mac = mac.upper()
        if self.allowed is not None and mac not in self.allowed:
            return []
        st = self.tags.setdefault(mac, _TagState())
        buf = st.buf[receiver]

        filtered = self._apply_filter(buf, rssi, t)
        buf.append(Sample(t, rssi, filtered))
        self._trim(buf, t)

        events: list[Event] = []

        # 히스테리시스: 시작은 FLOOR+margin, 유지 판정은 FLOOR
        if filtered >= P.RSSI_FLOOR:
            st.last_above = t
        if (not st.episode_active
                and filtered >= P.RSSI_FLOOR + P.EPISODE_START_MARGIN
                and t >= st.refractory_until):
            st.episode_active = True
            st.episode_start = t - P.EPISODE_PREROLL_SEC

        if st.episode_active:
            quiet = (t - st.last_above) >= P.EPISODE_QUIET_SEC
            too_long = (t - st.episode_start) >= P.EPISODE_MAX_SEC
            if quiet or too_long:
                ev = self._finalize(mac, st, end=t)
                st.episode_active = False
                if ev:
                    st.refractory_until = ev.detected_at + P.COOLDOWN_SEC
                    events.append(ev)
        return events

    def flush(self, now: float) -> list[Event]:
        """패킷이 끊겨도 (replay 종료·태그 이탈) 열린 에피소드를 마감."""
        out = []
        for mac, st in self.tags.items():
            if st.episode_active and (now - st.last_above) >= P.EPISODE_QUIET_SEC:
                ev = self._finalize(mac, st, end=now)
                st.episode_active = False
                if ev:
                    st.refractory_until = ev.detected_at + P.COOLDOWN_SEC
                    out.append(ev)
        return out

    # ── 내부 ────────────────────────────────────────────────
    def _apply_filter(self, buf: deque, rssi: float, t: float) -> float:
        if P.FILTER_MODE == "ema" and buf:
            prev = buf[-1]
            dt = max(t - prev.t, 1e-3)
            alpha = 1.0 - math.exp(-dt / P.EMA_TAU_SEC)
            return prev.filtered + alpha * (rssi - prev.filtered)
        # SMA(count 기반) — 노트북 검증 방식 (min_periods=1)
        recent = [s.rssi for s in list(buf)[-(P.SMA_WINDOW - 1):]] + [rssi]
        return float(np.mean(recent))

    @staticmethod
    def _trim(buf: deque, now: float):
        while buf and (now - buf[0].t) > P.BUFFER_KEEP_SEC:
            buf.popleft()

    def _episode_peaks(self, st: _TagState, receiver: str, end: float):
        """에피소드 구간의 (시각, 필터RSSI) 피크 목록 — 노트북 로직과 동일.
        RISE_GUARD: 피크 이전 최솟값 대비 상승폭이 작은 피크(정지 노이즈)는 기각."""
        seg_all = [s for s in st.buf[receiver] if st.episode_start <= s.t <= end]
        seg = [s for s in seg_all if s.filtered >= P.RSSI_FLOOR]
        if len(seg) < 2:
            return []
        vals = np.array([s.filtered for s in seg])
        idx, _ = find_peaks(vals, prominence=P.PROMINENCE)
        if len(idx) == 0:
            # 에피소드 절단으로 내부 극대점이 없을 수 있음 → 최강점 폴백
            idx = [int(np.argmax(vals))]
        peaks = []
        for i in idx:
            t_pk, r_pk = seg[i].t, seg[i].filtered
            if P.RISE_GUARD_DB > 0:
                before = [s.filtered for s in seg_all if s.t <= t_pk]
                if before and (r_pk - min(before)) < P.RISE_GUARD_DB:
                    continue
            peaks.append((t_pk, r_pk))
        return peaks

    def _finalize(self, mac: str, st: _TagState, end: float) -> Event | None:
        pa = self._episode_peaks(st, "A", end)
        pb = self._episode_peaks(st, "B", end)
        if not pa or not pb:
            if self.on_unpaired:
                self.on_unpaired(mac, st.episode_start, end,
                                 "A" if pa else ("B" if pb else "none"))
            return None
        # 유효 시간차 범위 내에서 가장 강한 (A,B) 피크 쌍 선택.
        # 최강 피크끼리 유효하면 노트북 로직과 동일 결과.
        # 노이즈로 최강 쌍이 범위를 벗어나도 차선 쌍으로 Miss 방지 (Miss > FP 원칙)
        best = None
        for t_a, r_a in pa:
            for t_b, r_b in pb:
                dt = abs(t_a - t_b)
                if P.MIN_CROSS_SEC <= dt <= P.MAX_CROSS_SEC:
                    score = r_a + r_b
                    if best is None or score > best[0]:
                        best = (score, t_a, r_a, t_b, r_b, dt)
        if best is None:
            t_a0 = max(pa, key=lambda x: x[1])[0]
            t_b0 = max(pb, key=lambda x: x[1])[0]
            if self.on_unpaired:
                self.on_unpaired(mac, st.episode_start, end,
                                 f"dt={abs(t_a0 - t_b0):.2f}")
            return None
        _, t_a, r_a, t_b, r_b, dt = best
        first = "A" if t_a < t_b else "B"
        direction = "entry" if (first == "A") ^ P.SWAP_AB else "exit"
        mid = (t_a + t_b) / 2.0
        eid = str(uuid.uuid5(
            _EVENT_NS, f"{self.site_id}|{mac}|{direction}|{round(mid)}"))
        return Event(event_id=eid, tag_mac=mac, direction=direction,
                     cross_sec=round(dt, 2), peak_a=round(r_a, 1),
                     peak_b=round(r_b, 1), detected_at=mid,
                     site_id=self.site_id)
