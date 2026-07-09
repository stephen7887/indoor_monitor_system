# ============================================================
# uploader.py — Supabase 업로드 + 오프라인 큐 + heartbeat
#
# 안전 원칙: 이벤트 유실은 안전 사고다.
#  - 모든 이벤트는 먼저 로컬 SQLite 큐에 기록(원자적) → 전송 성공 후 sent 표시
#  - LTE/네트워크 단절 시 큐에 쌓였다가 복구되면 오래된 것부터 재전송
#  - event_id 가 결정성(uuid5)이므로 upsert 로 중복 없이 재전송 가능
# ============================================================
from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from datetime import datetime, timezone

from supabase import create_client

import params as P
from algorithm import Event

log = logging.getLogger("uploader")


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


class Uploader(threading.Thread):
    def __init__(self, url: str, service_key: str, site_id: str, pi_id: str):
        super().__init__(daemon=True, name="uploader")
        self.sb = create_client(url, service_key)
        self.site_id = site_id
        self.pi_id = pi_id
        self._stop = threading.Event()
        self._db = sqlite3.connect(P.QUEUE_DB_PATH, check_same_thread=False)
        self._db_lock = threading.Lock()
        self._db.execute("""CREATE TABLE IF NOT EXISTS queue(
            id TEXT PRIMARY KEY, payload TEXT NOT NULL,
            created REAL NOT NULL, sent INTEGER DEFAULT 0)""")
        self._db.commit()

    # ── 외부 API ────────────────────────────────────────────
    def enqueue(self, ev: Event):
        payload = {
            "id": ev.event_id, "site_id": ev.site_id, "tag_mac": ev.tag_mac,
            "direction": ev.direction, "cross_sec": ev.cross_sec,
            "peak_a": ev.peak_a, "peak_b": ev.peak_b,
            "detected_at": _iso(ev.detected_at),
            "method": ev.method, "confidence": ev.confidence,
        }
        with self._db_lock:
            self._db.execute(
                "INSERT OR IGNORE INTO queue(id,payload,created) VALUES(?,?,?)",
                (ev.event_id, json.dumps(payload), time.time()))
            self._db.commit()
        log.info("큐 적재: %s %s cross=%.1fs", ev.tag_mac, ev.direction, ev.cross_sec)

    def fetch_allowed_macs(self) -> set[str] | None:
        """firefighters 테이블에서 활성 태그 목록. 실패 시 None(폴백 사용)."""
        try:
            rows = (self.sb.table("firefighters").select("tag_mac")
                    .eq("active", True).execute().data)
            macs = {r["tag_mac"].upper() for r in rows if r.get("tag_mac")}
            return macs or None
        except Exception as e:
            log.warning("firefighters 조회 실패(폴백 사용): %s", e)
            return None

    def stop(self):
        self._stop.set()

    # ── 백그라운드 루프 ─────────────────────────────────────
    def run(self):
        last_hb = 0.0
        while not self._stop.is_set():
            now = time.time()
            if now - last_hb >= P.HEARTBEAT_SEC:
                if self._heartbeat():
                    last_hb = now
            self._flush()
            self._stop.wait(1.0)

    def _pending(self, limit=50):
        with self._db_lock:
            return self._db.execute(
                "SELECT id,payload FROM queue WHERE sent=0 "
                "ORDER BY created LIMIT ?", (limit,)).fetchall()

    def _flush(self):
        rows = self._pending()
        if not rows:
            return
        try:
            payloads = [json.loads(p) for _, p in rows]
            self.sb.table("events").upsert(payloads).execute()
            with self._db_lock:
                self._db.executemany(
                    "UPDATE queue SET sent=1 WHERE id=?", [(i,) for i, _ in rows])
                self._db.commit()
            log.info("업로드 %d건 완료", len(rows))
        except Exception as e:
            log.warning("업로드 실패(%d건 대기, 재시도 예정): %s", len(rows), e)
            self._stop.wait(P.UPLOAD_RETRY_SEC)

    def _heartbeat(self) -> bool:
        try:
            self.sb.table("heartbeats").upsert({
                "pi_id": self.pi_id, "site_id": self.site_id,
                "last_seen": _iso(time.time()),
                "queue_depth": len(self._pending(9999)),
            }).execute()
            return True
        except Exception as e:
            log.warning("heartbeat 실패: %s", e)
            return False
