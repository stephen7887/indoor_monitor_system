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
    method: str = "peak"        # "peak" | "diff"
    confidence: float = 0.8     # ensemble 합의 시 상향


@dataclass
class _TagState:
    buf: dict = field(default_factory=lambda: {"A": deque(), "B": deque()})
    episode_active: bool = False
    episode_start: float = 0.0
    last_above: float = 0.0        # 마지막으로 FLOOR 위였던 시각 (A/B 통합)
    refractory_until: float = 0.0  # COOLDOWN 불응기
    # diff 상태머신 (v2)
    occ_state: str | None = None   # "inside" | "outside" | None(미확정)
    zone_cand: str | None = None
    zone_cand_since: float = 0.0
    state_confirmed_at: float = 0.0
    last_unpaired: tuple | None = None  # (receiver, t_peak, r_peak, ep_end)
    recent_events: list = field(default_factory=list)  # (t, direction) — 중복 제거용


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

        # ── diff 상태머신 (v2) ──
        if P.METHOD in ("diff", "ensemble"):
            ev = self._feed_diff(mac, st, t)
            if ev and self._accept(st, ev):
                events.append(ev)

        # ── peak 에피소드 방식 ──
        if P.METHOD not in ("peak", "ensemble"):
            return events

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
                if ev and self._accept(st, ev):
                    st.refractory_until = ev.detected_at + P.COOLDOWN_SEC
                    events.append(ev)
        return events

    # ── 중복 제거 + diff 상태 동기화 ────────────────────────
    def _accept(self, st: _TagState, ev: Event) -> bool:
        st.recent_events = [(t, d) for t, d in st.recent_events
                            if ev.detected_at - t < P.ENSEMBLE_DEDUPE_SEC]
        for t, d in st.recent_events:
            if d == ev.direction:
                return False  # 다른 방식이 이미 같은 이벤트를 냄 (중복)
            # 반대 방향 충돌: 먼저 확정된 이벤트가 이긴다.
            # 같은 통과를 두 방식이 다르게 읽은 것 — 나중 것은 기각하고
            # 상태는 먼저 확정된 방향으로 유지
            st.occ_state = "inside" if d == "entry" else "outside"
            return False
        st.recent_events.append((ev.detected_at, ev.direction))
        # peak 이벤트가 확정되면 diff 상태도 그 방향으로 동기화 (모순 방지)
        st.occ_state = "inside" if ev.direction == "entry" else "outside"
        return True

    # ── diff 상태머신 (v2): 안쪽−바깥쪽 차분 + 히스테리시스 ──
    def _feed_diff(self, mac: str, st: _TagState, t: float) -> Event | None:
        in_rec, out_rec = ("A", "B") if P.SWAP_AB else ("B", "A")
        bi, bo = st.buf[in_rec], st.buf[out_rec]
        if not bi or not bo:
            return None
        si, so = bi[-1], bo[-1]
        if abs(si.t - so.t) > P.DIFF_PAIR_MAX_AGE:
            return None
        if max(si.filtered, so.filtered) < P.RSSI_FLOOR:
            st.zone_cand = None   # 태그 부재 — 상태는 유지 (깊이 들어간 경우)
            return None
        # 양쪽 모두 의미 있는 신호일 때만 구역 판정 (통과 후 꼬리 FP 차단)
        if min(si.filtered, so.filtered) < P.RSSI_FLOOR - P.DIFF_BOTH_MARGIN_DB:
            return None
        diff = si.filtered - so.filtered
        if diff > P.DIFF_HYST_DB:
            zone = "inside"
        elif diff < -P.DIFF_HYST_DB:
            zone = "outside"
        else:
            return None           # 중간지대 — 후보 유지, 시계만 흐름
        if zone != st.zone_cand:
            st.zone_cand, st.zone_cand_since = zone, t
            return None
        if t - st.zone_cand_since < P.DIFF_STABLE_SEC:
            return None
        if st.occ_state is None:          # 최초 관측 — 이벤트 없이 상태만 설정
            st.occ_state = zone
            st.state_confirmed_at = t
            return None
        if zone == st.occ_state:          # 재확인 — 상태 신선도 갱신
            st.state_confirmed_at = t
            return None
        if t < st.refractory_until:
            return None
        # 상태가 오래됐으면(미관측 이탈 가능) 이벤트 없이 재정렬만 — 보정 FP 방지
        if t - st.state_confirmed_at > P.DIFF_STATE_TTL_SEC:
            st.occ_state = zone
            st.state_confirmed_at = t
            return None
        st.occ_state = zone
        st.state_confirmed_at = t
        direction = "entry" if zone == "inside" else "exit"
        mid = st.zone_cand_since
        eid = str(uuid.uuid5(
            _EVENT_NS, f"{self.site_id}|{mac}|{direction}|{round(mid)}"))
        return Event(event_id=eid, tag_mac=mac, direction=direction,
                     cross_sec=0.0, peak_a=round(so.filtered, 1),
                     peak_b=round(si.filtered, 1), detected_at=mid,
                     site_id=self.site_id, method="diff", confidence=0.7)

    def flush(self, now: float) -> list[Event]:
        """패킷이 끊겨도 (replay 종료·태그 이탈) 열린 에피소드를 마감."""
        out = []
        for mac, st in self.tags.items():
            if st.episode_active and (now - st.last_above) >= P.EPISODE_QUIET_SEC:
                ev = self._finalize(mac, st, end=now)
                st.episode_active = False
                if ev and self._accept(st, ev):
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
        if P.FILTER_MODE == "kalman":
            # 1D 칼만: 상태=RSSI, 프로세스 노이즈는 경과시간 비례
            if not buf:
                self._kp = getattr(self, "_kp", {})
                key = id(buf)
                self._kp[key] = P.KALMAN_P0
                return rssi
            prev = buf[-1]
            key = id(buf)
            kp = getattr(self, "_kp", {}).setdefault(key, P.KALMAN_P0)
            dt = max(t - prev.t, 1e-3)
            pk = kp + P.KALMAN_Q * dt
            K = pk / (pk + P.KALMAN_R)
            self._kp[key] = (1 - K) * pk
            return prev.filtered + K * (rssi - prev.filtered)
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
            ev = self._try_merge_unpaired(mac, st, pa, pb, end)
            if ev:
                return ev
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
        confidence = self._confidence(st, t_a, t_b, r_a, r_b, end)
        first = "A" if t_a < t_b else "B"
        direction = "entry" if (first == "A") ^ P.SWAP_AB else "exit"
        mid = (t_a + t_b) / 2.0
        eid = str(uuid.uuid5(
            _EVENT_NS, f"{self.site_id}|{mac}|{direction}|{round(mid)}"))
        return Event(event_id=eid, tag_mac=mac, direction=direction,
                     cross_sec=round(dt, 2), peak_a=round(r_a, 1),
                     peak_b=round(r_b, 1), detected_at=mid,
                     site_id=self.site_id, method="peak",
                     confidence=confidence)

    def _try_merge_unpaired(self, mac: str, st: _TagState,
                            pa, pb, end: float):
        """한쪽 수신기만 잡힌 에피소드가 연달아 쪼개진 경우 복구.
        직전 미확정 에피소드(반대편 수신기)와 최강 피크를 페어링."""
        peaks = pa or pb
        if not peaks:
            st.last_unpaired = None
            return None
        rec = "A" if pa else "B"
        t_pk, r_pk = max(peaks, key=lambda x: x[1])
        prev = st.last_unpaired
        st.last_unpaired = (rec, t_pk, r_pk, end)
        if not prev or prev[0] == rec:
            return None
        if st.episode_start - prev[3] > P.MERGE_GAP_SEC:
            return None  # 너무 오래된 조각
        t_o, r_o = prev[1], prev[2]
        dt = abs(t_pk - t_o)
        if not (P.MIN_CROSS_SEC <= dt <= P.MAX_CROSS_SEC):
            return None
        t_a2, r_a2 = (t_pk, r_pk) if rec == "A" else (t_o, r_o)
        t_b2, r_b2 = (t_o, r_o) if rec == "A" else (t_pk, r_pk)
        first = "A" if t_a2 < t_b2 else "B"
        direction = "entry" if (first == "A") ^ P.SWAP_AB else "exit"
        mid = (t_a2 + t_b2) / 2.0
        st.last_unpaired = None
        eid = str(uuid.uuid5(
            _EVENT_NS, f"{self.site_id}|{mac}|{direction}|{round(mid)}"))
        return Event(event_id=eid, tag_mac=mac, direction=direction,
                     cross_sec=round(dt, 2), peak_a=round(r_a2, 1),
                     peak_b=round(r_b2, 1), detected_at=mid,
                     site_id=self.site_id, method="peak-merge",
                     confidence=0.55)

    def _confidence(self, st: _TagState, t_a: float, t_b: float,
                    r_a: float, r_b: float, end: float) -> float:
        """walk-by(미통과) FP 판별 특징으로 이벤트 신뢰도 산출 (억제 아님 — Miss>FP).
        특징 1: A-B 우세 반전 (진짜 통과는 이벤트 전후 우세가 뒤집힘)
        특징 2: 약한 반대편 피크 (미통과는 반대편이 반사파로만 잡혀 약함)"""
        mid = (t_a + t_b) / 2.0
        before, after = [], []
        bins_a, bins_b = {}, {}
        for rec, bins in (("A", bins_a), ("B", bins_b)):
            for s in st.buf[rec]:
                off = round(s.t - mid)
                if -5 <= off <= 5 and off != 0:
                    bins.setdefault(off, []).append(s.filtered)
        for off in range(-5, 6):
            if off == 0 or off not in bins_a or off not in bins_b:
                continue
            d = float(np.mean(bins_a[off]) - np.mean(bins_b[off]))
            (before if off < 0 else after).append(d)
        conf = 0.6
        if before and after:
            b, a = float(np.mean(before)), float(np.mean(after))
            if b * a < 0 and abs(b - a) >= 3.0:
                conf += 0.3          # 우세 반전 확인 = 강한 통과 증거
            elif b * a > 0 and abs(b) > 3 and abs(a) > 3:
                conf -= 0.2          # 한쪽이 끝까지 우세 = walk-by 의심
        if min(r_a, r_b) < P.RSSI_FLOOR + 6:
            conf -= 0.1              # 반대편 피크 미약
        return round(min(0.95, max(0.2, conf)), 2)
