#!/usr/bin/env python3
# ============================================================
# replay.py — 기존 실험 CSV로 실시간 판정기 회귀 검증
#
# 사용법:
#   python3 replay.py ble_scan_A_500ms.csv ble_scan_B_500ms.csv
#   python3 replay.py A.csv B.csv --gt gt_500ms.csv   # GT 채점까지
#
# CSV 포맷: 노트북과 동일 (Time, Elapsed_ms, MAC_Address, RSSI)
# GT CSV 포맷: start,end,direction  (예: 19:03:00,19:03:08,Enter)
#
# 알고리즘 변경 전후로 반드시 이 스크립트로 4지표를 비교한다 (CLAUDE.md §5).
# ============================================================
from __future__ import annotations

import argparse
import csv

import numpy as np
import pandas as pd

import params as P
from algorithm import Detector

MATCH_TOLERANCE_SEC = 5.0


def gt_str_to_sec(s: str) -> float:
    h, m, sec = s.split(":")
    return int(h) * 3600 + int(m) * 60 + float(sec)


def load_csv(path: str) -> pd.DataFrame:
    """노트북 load_and_preprocess와 동일한 시간 처리."""
    df = pd.read_csv(path, comment="#")
    df["RSSI"] = pd.to_numeric(df["RSSI"], errors="coerce")
    df["Elapsed_ms"] = pd.to_numeric(df["Elapsed_ms"], errors="coerce")
    df = df.dropna(subset=["RSSI", "Elapsed_ms"]).reset_index(drop=True)
    try:
        t = pd.to_datetime(df["Time"], format="%H:%M:%S.%f").dt
    except ValueError:
        t = pd.to_datetime(df["Time"], format="%H:%M:%S").dt
    df["Wall_sec"] = t.hour * 3600 + t.minute * 60 + t.second + t.microsecond / 1e6
    if df["Wall_sec"].diff().min() < -3600:
        wrap = df["Wall_sec"].diff().idxmin()
        df.loc[wrap:, "Wall_sec"] += 86400
    elapsed = df["Elapsed_ms"] / 1000.0
    offset = float(np.median(df["Wall_sec"] - elapsed))
    df["T"] = elapsed + offset
    return df


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file_a")
    ap.add_argument("file_b")
    ap.add_argument("--gt", help="GT CSV (start,end,direction)")
    args = ap.parse_args()

    da, db = load_csv(args.file_a), load_csv(args.file_b)
    stream = sorted(
        [("A", r.MAC_Address, r.RSSI, r.T) for r in da.itertuples()]
        + [("B", r.MAC_Address, r.RSSI, r.T) for r in db.itertuples()],
        key=lambda x: x[3])

    det = Detector(site_id="replay")
    events = []
    for rec, mac, rssi, t in stream:
        events += det.feed(rec, str(mac), float(rssi), float(t))
    events += det.flush(stream[-1][3] + P.EPISODE_QUIET_SEC + 1)

    print(f"\n감지 이벤트 {len(events)}건:")
    for ev in events:
        h = int(ev.detected_at // 3600) % 24
        m = int(ev.detected_at % 3600 // 60)
        s = ev.detected_at % 60
        print(f"  {h:02d}:{m:02d}:{s:05.2f}  {ev.direction:5s} "
              f"cross={ev.cross_sec:4.1f}s  tag={ev.tag_mac}")

    if not args.gt:
        return

    gt = []
    with open(args.gt) as f:
        for row in csv.reader(f):
            if len(row) >= 3 and ":" in row[0]:
                gt.append((gt_str_to_sec(row[0]), gt_str_to_sec(row[1]),
                           row[2].strip().lower()))
    used, matched, dir_ok = set(), 0, 0
    for g_lo, g_hi, g_dir in gt:
        lo, hi = g_lo - MATCH_TOLERANCE_SEC, g_hi + MATCH_TOLERANCE_SEC
        mid = (g_lo + g_hi) / 2
        best, dist = None, None
        for i, ev in enumerate(events):
            if i in used or not (lo <= ev.detected_at % 86400 <= hi):
                continue
            d = abs(ev.detected_at % 86400 - mid)
            if best is None or d < dist:
                best, dist = i, d
        if best is not None:
            used.add(best)
            matched += 1
            g = "entry" if g_dir in ("enter", "entry") else "exit"
            if events[best].direction == g:
                dir_ok += 1
    fp = len(events) - len(used)
    print(f"\n== 4지표 ==")
    print(f"감지율      : {matched}/{len(gt)} = {matched/len(gt)*100:.1f}%")
    print(f"방향정확도  : {dir_ok}/{matched} = "
          f"{dir_ok/matched*100 if matched else 0:.1f}%")
    print(f"FP          : {fp}")
    print(f"Miss        : {len(gt)-matched}")


if __name__ == "__main__":
    main()
