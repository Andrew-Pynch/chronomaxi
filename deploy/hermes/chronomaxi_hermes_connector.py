#!/usr/bin/env python3
"""Chronomaxi data connector for Hermes scripts on big-bertha."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.request
from collections import Counter, defaultdict
from datetime import date as Date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

HOME = Path.home()
CHRONOMAXI_DIR = Path(os.environ.get("CHRONOMAXI_REPO", str(HOME / "work/personal-agent-monorepo/packages/chronomaxi")))
ENV_PATHS = [
    Path(os.environ.get("CHRONOMAXI_ENV_FILE", str(HOME / ".config/chronomaxi/env"))),
    CHRONOMAXI_DIR / ".env.local",
    CHRONOMAXI_DIR / "frontend/.env.local",
    CHRONOMAXI_DIR / "frontend/.env",
]
CONVEX_URL_DEFAULT = "http://127.0.0.1:3210"
TZ = ZoneInfo(os.environ.get("CHRONOMAXI_TIMEZONE", "America/Chicago"))
MS_PER_MINUTE = 60_000
MS_PER_HOUR = 3_600_000
TITLE_FIELDS = {"title", "windowTitle", "browserTitle", "rawTitle", "activeWindowTitle"}


def load_env(paths: list[Path] = ENV_PATHS) -> dict[str, str]:
    values: dict[str, str] = {}
    for path in paths:
        try:
            lines = path.read_text().splitlines()
        except FileNotFoundError:
            continue
        for raw in lines:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            value = value.strip().strip('"').strip("'")
            values.setdefault(key.strip(), value)
    return values


def day_bounds(day_key: str) -> tuple[int, int]:
    start = datetime.strptime(day_key, "%Y-%m-%d").replace(tzinfo=TZ)
    end = start + timedelta(days=1)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def today_key() -> str:
    return datetime.now(TZ).date().isoformat()


def yesterday_key() -> str:
    return (datetime.now(TZ).date() - timedelta(days=1)).isoformat()


def query_convex(path: str, args: dict[str, Any] | None = None, env: dict[str, str] | None = None) -> Any:
    env = env or load_env()
    base_url = (
        env.get("CONVEX_SELF_HOSTED_URL")
        or env.get("NEXT_PUBLIC_CONVEX_URL")
        or os.environ.get("CONVEX_SELF_HOSTED_URL")
        or os.environ.get("NEXT_PUBLIC_CONVEX_URL")
        or CONVEX_URL_DEFAULT
    ).rstrip("/")
    headers = {"Content-Type": "application/json", "Convex-Client": "chronomaxi-hermes"}
    admin_key = env.get("CONVEX_SELF_HOSTED_ADMIN_KEY") or os.environ.get("CONVEX_SELF_HOSTED_ADMIN_KEY")
    if admin_key:
        headers["Authorization"] = "Convex " + admin_key
    payload = {"path": path, "format": "json", "args": [args or {}]}
    request = urllib.request.Request(
        f"{base_url}/api/query",
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        result = json.loads(response.read().decode("utf-8"))
    if result.get("status") != "success":
        raise RuntimeError(result.get("errorMessage") or json.dumps(result)[:500])
    return result.get("value")


def run_convex_data(table: str, limit: int, order: str = "desc") -> list[dict[str, Any]]:
    bun = os.environ.get("BUN_BIN", str(HOME / ".bun/bin/bunx"))
    if not Path(bun).exists():
        bun = "bunx"
    cmd = [bun, "convex", "data", table, "--format", "json", "--limit", str(limit), "--order", order]
    proc = subprocess.run(
        cmd,
        cwd=CHRONOMAXI_DIR,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=60,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"convex data {table} failed: {proc.stderr.strip() or proc.stdout.strip()}")
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"convex data {table} returned non-json output") from exc
    if not isinstance(data, list):
        raise RuntimeError(f"convex data {table} returned {type(data).__name__}, expected list")
    return data


def sanitize_span(span: dict[str, Any]) -> dict[str, Any]:
    started = int(span.get("startedAt") or span.get("createdAt") or 0)
    ended = int(span.get("endedAt") or started)
    safe = {
        "startedAt": started,
        "endedAt": ended,
        "localStart": datetime.fromtimestamp(started / 1000, TZ).strftime("%H:%M"),
        "localEnd": datetime.fromtimestamp(ended / 1000, TZ).strftime("%H:%M"),
        "durationMinutes": round(max(0, ended - started) / MS_PER_MINUTE, 2),
        "program": str(span.get("program") or "unknown"),
        "subProgram": str(span.get("subProgram") or "")[:80] or None,
        "category": str(span.get("category") or "Other"),
        "deviceName": str(span.get("deviceName") or "unknown"),
        "actor": str(span.get("actor") or "unknown"),
        "agentName": span.get("agentName"),
        "isIdle": bool(span.get("isIdle", False)),
        "keysPressedCount": int(span.get("keysPressedCount") or 0),
        "leftClickCount": int(span.get("leftClickCount") or 0),
        "rightClickCount": int(span.get("rightClickCount") or 0),
        "middleClickCount": int(span.get("middleClickCount") or 0),
    }
    return {k: v for k, v in safe.items() if v not in (None, "")}


def spans_for_window(start_ms: int, end_ms: int, limit: int | None = None) -> list[dict[str, Any]]:
    limit = min(limit or int(os.environ.get("CHRONOMAXI_HERMES_SPAN_LIMIT", "8000")), 8000)
    rows = run_convex_data("spans", limit=limit, order="desc")
    spans = []
    for row in rows:
        if any(field in row for field in TITLE_FIELDS):
            row = {k: v for k, v in row.items() if k not in TITLE_FIELDS}
        started = int(row.get("startedAt") or row.get("createdAt") or 0)
        ended = int(row.get("endedAt") or started)
        if ended <= start_ms or started >= end_ms:
            continue
        spans.append(sanitize_span(row))
    spans.sort(key=lambda item: item["startedAt"])
    return spans


def aggregate_spans(spans: list[dict[str, Any]]) -> dict[str, Any]:
    by_category: dict[str, float] = defaultdict(float)
    by_program: dict[str, float] = defaultdict(float)
    by_device: dict[str, float] = defaultdict(float)
    by_actor: dict[str, float] = defaultdict(float)
    input_totals = Counter()
    for span in spans:
        minutes = float(span.get("durationMinutes") or 0)
        by_category[str(span.get("category") or "Other")] += minutes
        by_program[str(span.get("program") or "unknown")] += minutes
        by_device[str(span.get("deviceName") or "unknown")] += minutes
        by_actor[str(span.get("actor") or "unknown")] += minutes
        input_totals["keysPressedCount"] += int(span.get("keysPressedCount") or 0)
        input_totals["leftClickCount"] += int(span.get("leftClickCount") or 0)
        input_totals["rightClickCount"] += int(span.get("rightClickCount") or 0)
        input_totals["middleClickCount"] += int(span.get("middleClickCount") or 0)
    def top(mapping: dict[str, float], n: int = 12) -> list[dict[str, Any]]:
        return [
            {"name": key, "minutes": round(value, 2), "hours": round(value / 60, 2)}
            for key, value in sorted(mapping.items(), key=lambda item: item[1], reverse=True)[:n]
        ]
    return {
        "spanCount": len(spans),
        "activeMinutes": round(sum(s.get("durationMinutes", 0) for s in spans if not s.get("isIdle")), 2),
        "idleMinutes": round(sum(s.get("durationMinutes", 0) for s in spans if s.get("isIdle")), 2),
        "topCategories": top(by_category),
        "topPrograms": top(by_program),
        "byDevice": top(by_device, 20),
        "byActor": top(by_actor, 20),
        "inputTotals": dict(input_totals),
    }


def get_day_summary(day_key: str | None = None) -> dict[str, Any]:
    day_key = day_key or today_key()
    env = load_env()
    dashboard = query_convex("dashboard:getDashboard", {}, env)
    start_ms, end_ms = day_bounds(day_key)
    spans = spans_for_window(start_ms, end_ms)
    day = None
    for candidate in dashboard.get("days", []):
        if candidate.get("date") == day_key:
            day = candidate
            break
    if day is None and dashboard.get("today", {}).get("date") == day_key:
        day = dashboard["today"]
    return {
        "date": day_key,
        "timezone": str(TZ),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "convexUrl": (env.get("CONVEX_SELF_HOSTED_URL") or env.get("NEXT_PUBLIC_CONVEX_URL") or CONVEX_URL_DEFAULT),
            "aggregatesQuery": "dashboard:getDashboard",
            "spansTable": "spans",
        },
        "dailyAggregate": day or {},
        "hourly": dashboard.get("hourlyToday", []) if day_key == today_key() else [],
        "programs": dashboard.get("programsToday", []) if day_key == today_key() else [],
        "categories": dashboard.get("categoriesToday", []) if day_key == today_key() else [],
        "spanAggregate": aggregate_spans(spans),
        "spans": spans,
    }


def recent_summary(hours: float = 2.0) -> dict[str, Any]:
    end_ms = int(datetime.now(TZ).timestamp() * 1000)
    start_ms = end_ms - int(hours * MS_PER_HOUR)
    spans = spans_for_window(start_ms, end_ms, limit=int(os.environ.get("CHRONOMAXI_HERMES_RECENT_LIMIT", "1500")))
    return {
        "timezone": str(TZ),
        "windowHours": hours,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "spanAggregate": aggregate_spans(spans),
        "spans": spans,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Read Chronomaxi Convex summaries for Hermes")
    parser.add_argument("--date", default=today_key(), help="YYYY-MM-DD local date")
    parser.add_argument("--recent-hours", type=float, default=0.0)
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()
    data = recent_summary(args.recent_hours) if args.recent_hours > 0 else get_day_summary(args.date)
    print(json.dumps(data, indent=2 if args.pretty else None, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
