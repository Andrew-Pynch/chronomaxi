#!/usr/bin/env python3
"""Chronomaxi Slack steering watcher for Hermes."""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from chronomaxi_dream import call_hermes, post_slack
from chronomaxi_hermes_connector import recent_summary

HOME = Path.home()
STATE_DIR = Path(os.environ.get("CHRONOMAXI_HERMES_STATE_DIR", str(HOME / ".hermes/chronomaxi_hermes")))
STATE_PATH = Path(os.environ.get("CHRONOMAXI_STEERING_STATE", str(STATE_DIR / "steering_state.json")))
SLACK_CHANNEL = os.environ.get("CHRONOMAXI_HERMES_SLACK_CHANNEL", "C0B6Q5X4WAG")
TZ = ZoneInfo(os.environ.get("CHRONOMAXI_TIMEZONE", "America/Chicago"))
MAX_PER_DAY = int(os.environ.get("CHRONOMAXI_STEERING_MAX_PER_DAY", "2"))


def load_state() -> dict[str, Any]:
    try:
        return json.loads(STATE_PATH.read_text())
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError:
        return {}


def save_state(state: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(STATE_PATH)


def today_bucket() -> str:
    return datetime.now(TZ).date().isoformat()


def prune_state(state: dict[str, Any]) -> dict[str, Any]:
    bucket = today_bucket()
    days = state.get("days", {})
    state["days"] = {bucket: days.get(bucket, [])}
    return state


def can_post(state: dict[str, Any]) -> tuple[bool, str]:
    state = prune_state(state)
    entries = state.get("days", {}).get(today_bucket(), [])
    if len(entries) >= MAX_PER_DAY:
        return False, f"daily limit reached ({len(entries)}/{MAX_PER_DAY})"
    return True, f"daily count {len(entries)}/{MAX_PER_DAY}"


def record_post(state: dict[str, Any], dry_run: bool, message: str) -> None:
    state = prune_state(state)
    bucket = today_bucket()
    state.setdefault("days", {}).setdefault(bucket, []).append({
        "ts": int(time.time()),
        "dryRun": dry_run,
        "messagePreview": message[:160],
    })
    save_state(state)


def decision_prompt(summary: dict[str, Any]) -> list[dict[str, str]]:
    safe = {
        "timezone": summary.get("timezone"),
        "windowHours": summary.get("windowHours"),
        "spanAggregate": summary.get("spanAggregate", {}),
        "safeSpans": summary.get("spans", [])[-80:],
        "policy": {
            "workHoursOnly": True,
            "postWhen": "sustained non-work or idle drift during waking work hours, not one short break",
            "privacy": "Never mention raw titles. Use only categories, programs, broad time blocks, and counts.",
            "tone": "helpful, wry, never preachy",
        },
    }
    user = (
        "Judge whether Andrew appears distracted in the last telemetry window. "
        "Return strict JSON with keys distracted boolean, confidence number 0 to 1, reason string, and message string. "
        "If distracted is true, message must be one gentle Slack nudge under 300 chars. "
        "Do not include raw window or browser titles. Data follows.\n\n"
        + json.dumps(safe, indent=2, sort_keys=True)
    )
    return [
        {"role": "system", "content": "You are a light-touch productivity steering assistant for Andrew."},
        {"role": "user", "content": user},
    ]


def parse_decision(text: str) -> dict[str, Any]:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.strip("`")
        if stripped.lower().startswith("json"):
            stripped = stripped[4:].strip()
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end >= start:
        stripped = stripped[start : end + 1]
    data = json.loads(stripped)
    return {
        "distracted": bool(data.get("distracted")),
        "confidence": float(data.get("confidence") or 0),
        "reason": str(data.get("reason") or ""),
        "message": str(data.get("message") or "").strip(),
    }


def evaluate(hours: float, force_distracted: bool = False) -> dict[str, Any]:
    if force_distracted:
        return {
            "summary": {"spanAggregate": {"spanCount": 0}},
            "decision": {
                "distracted": True,
                "confidence": 1.0,
                "reason": "forced test decision",
                "message": "Tiny course correction: if the shiny object is winning, maybe put one brick back on the wall before it unionizes.",
            },
        }
    summary = recent_summary(hours)
    text = call_hermes(decision_prompt(summary), temperature=0.1)
    return {"summary": summary, "decision": parse_decision(text)}


def run(hours: float, dry_run: bool, record_state: bool, force_distracted: bool = False) -> dict[str, Any]:
    state = load_state()
    allowed, rate_reason = can_post(state)
    evaluated = evaluate(hours, force_distracted=force_distracted)
    decision = evaluated["decision"]
    posted = False
    message = decision.get("message", "")
    if decision.get("distracted") and allowed and message:
        if not dry_run:
            post_slack(message, SLACK_CHANNEL)
            record_post(state, dry_run=False, message=message)
            posted = True
        elif record_state:
            record_post(state, dry_run=True, message=message)
    return {
        "posted": posted,
        "dryRun": dry_run,
        "recordedState": bool(dry_run and record_state and decision.get("distracted") and allowed and message),
        "rateAllowed": allowed,
        "rateReason": rate_reason,
        "decision": decision,
        "spanCount": evaluated["summary"].get("spanAggregate", {}).get("spanCount", 0),
        "statePath": str(STATE_PATH),
    }


def test_rate_limit() -> dict[str, Any]:
    state = load_state()
    original = json.loads(json.dumps(state))
    try:
        state = prune_state(state)
        bucket = today_bucket()
        state["days"] = {bucket: []}
        save_state(state)
        first = run(2.0, dry_run=True, record_state=True, force_distracted=True)
        second = run(2.0, dry_run=True, record_state=True, force_distracted=True)
        third = run(2.0, dry_run=True, record_state=True, force_distracted=True)
        return {"first": first, "second": second, "third": third, "statePath": str(STATE_PATH)}
    finally:
        save_state(original)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Chronomaxi Hermes steering watcher")
    parser.add_argument("--hours", type=float, default=2.0)
    parser.add_argument("--dry-run", action="store_true", help="Evaluate and print without Slack")
    parser.add_argument("--record-state", action="store_true", help="With --dry-run, record a dry-run nudge for rate-limit testing")
    parser.add_argument("--force-distracted", action="store_true", help="Use a deterministic distracted decision for testing")
    parser.add_argument("--test-rate-limit", action="store_true", help="Exercise the two per day rate limit without Slack")
    args = parser.parse_args()
    if args.test_rate_limit:
        result = test_rate_limit()
    else:
        result = run(args.hours, dry_run=args.dry_run, record_state=args.record_state, force_distracted=args.force_distracted)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
