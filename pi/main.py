#!/usr/bin/env python3
# ============================================================
# main.py — 라즈베리파이 메인: 수집 → 판정 → 업로드
#
# 실행:  python3 main.py
# 사전 준비: .env 작성 (README 참조), pip install -r requirements.txt
# ============================================================
from __future__ import annotations

import logging
import os
import signal
import sys
import time
from queue import Empty, Queue

from dotenv import load_dotenv

import params as P
from algorithm import Detector
from serial_reader import SerialReader
from uploader import Uploader

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
log = logging.getLogger("main")


def require(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        log.error(".env에 %s 가 없습니다. README를 참조하세요.", name)
        sys.exit(1)
    return v


def main():
    load_dotenv()
    url = require("SUPABASE_URL")
    key = require("SUPABASE_SERVICE_KEY")
    site_id = os.environ.get("SITE_ID", "demo-site")
    pi_id = os.environ.get("PI_ID", "pi-1")
    port_a = require("SERIAL_PORT_A")   # 문 바깥쪽 수신기
    port_b = require("SERIAL_PORT_B")   # 문 안쪽 수신기

    up = Uploader(url, key, site_id, pi_id)
    up.start()

    allowed = up.fetch_allowed_macs()
    if allowed is None:
        allowed = set(P.FALLBACK_TAG_MACS) or None
    log.info("허용 태그: %s", "전체(등록제 아님 — 실험 모드)" if allowed is None
             else f"{len(allowed)}개")

    def on_unpaired(mac, start, end, why):
        log.info("미확정 에피소드: tag=%s %.1f~%.1f (%s)", mac, start, end, why)

    det = Detector(site_id, allowed_macs=allowed, on_unpaired=on_unpaired)

    q: Queue = Queue()
    readers = [SerialReader("A", port_a, q), SerialReader("B", port_b, q)]
    for r in readers:
        r.start()

    running = True

    def shutdown(*_):
        nonlocal running
        running = False
    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    log.info("가동 시작 (site=%s, pi=%s)", site_id, pi_id)
    last_flush = time.time()
    while running:
        try:
            receiver, mac, rssi, t = q.get(timeout=0.5)
            for ev in det.feed(receiver, mac, rssi, t):
                log.info(">>> 이벤트: %s %s cross=%.1fs peakA=%.0f peakB=%.0f",
                         ev.tag_mac, ev.direction.upper(), ev.cross_sec,
                         ev.peak_a, ev.peak_b)
                up.enqueue(ev)
        except Empty:
            pass
        # 패킷이 끊긴 태그의 열린 에피소드 주기적 마감
        now = time.time()
        if now - last_flush >= 1.0:
            for ev in det.flush(now):
                log.info(">>> 이벤트(flush): %s %s cross=%.1fs",
                         ev.tag_mac, ev.direction.upper(), ev.cross_sec)
                up.enqueue(ev)
            last_flush = now

    log.info("종료 중...")
    for r in readers:
        r.stop()
    up.stop()
    up.join(timeout=5)


if __name__ == "__main__":
    main()
