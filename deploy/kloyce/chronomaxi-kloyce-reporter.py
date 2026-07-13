#!/usr/bin/env python3
"""Report Kloyce transcription word counts to Chronomaxi."""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export ") :]
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            values[key] = value
    return values


def event_stream(url: str):
    req = urllib.request.Request(url, headers={"Accept": "text/event-stream"})
    with urllib.request.urlopen(req, timeout=70) as resp:
        data_lines: list[str] = []
        for raw in resp:
            line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
            if line == "":
                if data_lines:
                    yield "\n".join(data_lines)
                    data_lines = []
                continue
            if line.startswith("data:"):
                data_lines.append(line[5:].lstrip())


def load_seen(path: Path) -> set[str]:
    try:
        return set(json.loads(path.read_text()))
    except Exception:
        return set()


def save_seen(path: Path, seen: set[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    values = sorted(seen)[-2048:]
    path.write_text(json.dumps(values))


def post_dictation(ingest_url: str, secret: str, payload: dict) -> None:
    base = ingest_url.rstrip("/")
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{base}/dictation",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {secret}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        if resp.status < 200 or resp.status >= 300:
            raise RuntimeError(f"unexpected status {resp.status}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kloyce-events", default="http://127.0.0.1:9876/api/events")
    parser.add_argument("--env-file", default=str(Path.home() / ".config/chronomaxi/env"))
    parser.add_argument("--state-file", default=str(Path.home() / ".local/state/chronomaxi/kloyce-reporter-seen.json"))
    parser.add_argument("--host", default=socket.gethostname())
    args = parser.parse_args()

    env = {**load_env(Path(args.env_file)), **os.environ}
    ingest_url = env.get("CHRONOMAXI_INGEST_URL", "").strip()
    secret = env.get("CHRONOMAXI_INGEST_SECRET", "").strip()
    if not ingest_url or not secret:
        print("missing CHRONOMAXI_INGEST_URL or CHRONOMAXI_INGEST_SECRET", file=sys.stderr)
        return 78

    seen_path = Path(args.state_file)
    seen = load_seen(seen_path)

    while True:
        try:
            for item in event_stream(args.kloyce_events):
                try:
                    event = json.loads(item)
                except json.JSONDecodeError:
                    continue
                if event.get("type") != "transcription":
                    continue
                recording_id = str(event.get("recording_id") or "")
                key = recording_id or f"{event.get('timestamp')}:{event.get('word_count')}:{hash(event.get('text', ''))}"
                if key in seen:
                    continue
                words = int(event.get("word_count") or 0)
                if words <= 0:
                    seen.add(key)
                    save_seen(seen_path, seen)
                    continue
                payload = {
                    "host": args.host,
                    "ts": event.get("timestamp") or int(time.time()),
                    "words": words,
                    "source": "kloyce",
                }
                post_dictation(ingest_url, secret, payload)
                seen.add(key)
                save_seen(seen_path, seen)
                print(f"reported {words} dictated words for {args.host}", flush=True)
        except (urllib.error.URLError, TimeoutError, RuntimeError, OSError) as error:
            print(f"reporter reconnecting after error: {error}", file=sys.stderr, flush=True)
            time.sleep(5)


if __name__ == "__main__":
    raise SystemExit(main())
