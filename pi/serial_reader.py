# ============================================================
# serial_reader.py — nRF52840 시리얼 수집
#
#  - 수신기 2대가 같은 Pi에 USB 연결 → 도착 시각을 Pi 시계(time.time())로
#    찍는다. 이것이 알고리즘의 유일한 시간축 (Elapsed_ms 불필요)
#  - 라인 포맷은 펌웨어마다 달라서 관대한 파서 사용:
#    한 줄에서 MAC(AA:BB:CC:DD:EE:FF)과 RSSI(-30~-100 정수)를 추출
#  - raw 라인은 전부 data/raw/ CSV에 보존 (CLAUDE.md: raw는 로컬 보관)
# ============================================================
from __future__ import annotations

import csv
import logging
import os
import re
import threading
import time
from datetime import datetime
from queue import Queue

import serial

import params as P

log = logging.getLogger("serial")

MAC_RE = re.compile(r"([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})")
RSSI_RE = re.compile(r"(-\d{2,3})")


def parse_line(line: str) -> tuple[str, float] | None:
    """라인에서 (MAC, RSSI) 추출. 실패 시 None."""
    m = MAC_RE.search(line)
    if not m:
        return None
    mac = m.group(1).upper()
    # MAC 뒷부분에서 RSSI 탐색 (MAC 안의 숫자 오인 방지)
    tail = line[m.end():] or line
    r = RSSI_RE.search(tail) or RSSI_RE.search(line)
    if not r:
        return None
    rssi = float(r.group(1))
    if not (-110.0 <= rssi <= -20.0):
        return None
    return mac, rssi


class SerialReader(threading.Thread):
    """수신기 1대 담당. (receiver, mac, rssi, t)를 out_q로 보낸다."""

    def __init__(self, receiver: str, port: str, out_q: Queue, raw_dir: str = "data/raw"):
        super().__init__(daemon=True, name=f"serial-{receiver}")
        self.receiver = receiver
        self.port = port
        self.out_q = out_q
        self._stop = threading.Event()
        os.makedirs(raw_dir, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self._raw_path = os.path.join(raw_dir, f"raw_{receiver}_{stamp}.csv")

    def stop(self):
        self._stop.set()

    def run(self):
        with open(self._raw_path, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["pi_time", "mac", "rssi", "raw_line"])
            while not self._stop.is_set():
                try:
                    self._read_loop(w, f)
                except serial.SerialException as e:
                    log.error("[%s] 시리얼 오류, 3초 후 재연결: %s", self.receiver, e)
                    time.sleep(3)

    def _read_loop(self, w, f):
        with serial.Serial(self.port, P.SERIAL_BAUD, timeout=1) as ser:
            log.info("[%s] 연결됨: %s", self.receiver, self.port)
            while not self._stop.is_set():
                raw = ser.readline()
                if not raw:
                    continue
                t = time.time()
                line = raw.decode(errors="replace").strip()
                if not line:
                    continue
                parsed = parse_line(line)
                if parsed:
                    mac, rssi = parsed
                    w.writerow([f"{t:.3f}", mac, rssi, line])
                    self.out_q.put((self.receiver, mac, rssi, t))
                else:
                    w.writerow([f"{t:.3f}", "", "", line])
                f.flush()
