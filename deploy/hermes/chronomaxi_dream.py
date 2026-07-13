#!/usr/bin/env python3
"""Nightly Chronomaxi productivity dream for Hermes."""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from chronomaxi_hermes_connector import get_day_summary, today_key, yesterday_key

HOME = Path.home()
HERMES_ENV = HOME / ".hermes/.env"
REPORT_DIR = Path(os.environ.get("CHRONOMAXI_DREAM_DIR", str(HOME / "chronomaxi-dreams")))
SLACK_CHANNEL = os.environ.get("CHRONOMAXI_HERMES_SLACK_CHANNEL", "C0B6Q5X4WAG")
HERMES_URL_OVERRIDE = os.environ.get("HERMES_OPENAI_BASE_URL")
TZ = ZoneInfo(os.environ.get("CHRONOMAXI_TIMEZONE", "America/Chicago"))


def load_env() -> dict[str, str]:
    values = dict(os.environ)
    try:
        lines = HERMES_ENV.read_text().splitlines()
    except FileNotFoundError:
        return values
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    return values


def post_slack(text: str, channel: str = SLACK_CHANNEL) -> dict[str, Any]:
    env = load_env()
    token = env.get("SLACK_BOT_TOKEN")
    if not token:
        raise RuntimeError("SLACK_BOT_TOKEN missing in Hermes env")
    payload = {"channel": channel, "text": text, "unfurl_links": False, "unfurl_media": False}
    request = urllib.request.Request(
        "https://slack.com/api/chat.postMessage",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        result = json.loads(response.read().decode("utf-8"))
    if not result.get("ok"):
        safe = {k: v for k, v in result.items() if k != "warning"}
        raise RuntimeError(f"Slack post failed: {safe}")
    return result


def hermes_openai_url(env: dict[str, str]) -> str:
    if HERMES_URL_OVERRIDE:
        return HERMES_URL_OVERRIDE.rstrip("/")
    host = env.get("API_SERVER_HOST") or "127.0.0.1"
    port = env.get("API_SERVER_PORT") or "9119"
    return f"http://{host}:{port}/v1"


def call_hermes(messages: list[dict[str, str]], temperature: float = 0.2) -> str:
    env = load_env()
    key = env.get("API_SERVER_KEY") or env.get("OPENAI_API_KEY") or "hermes-local"
    model = env.get("API_SERVER_MODEL_NAME") or os.environ.get("HERMES_MODEL") or "gpt-5.5"
    payload = {"model": model, "messages": messages, "temperature": temperature, "stream": False}
    request = urllib.request.Request(
        hermes_openai_url(env) + "/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=300) as response:
        result = json.loads(response.read().decode("utf-8"))
    try:
        return result["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError) as exc:
        raise RuntimeError(f"Hermes returned unexpected response keys: {sorted(result.keys())}") from exc


def compact_summary(summary: dict[str, Any]) -> dict[str, Any]:
    span_agg = summary.get("spanAggregate", {})
    return {
        "date": summary.get("date"),
        "timezone": summary.get("timezone"),
        "dailyAggregate": summary.get("dailyAggregate", {}),
        "spanAggregate": span_agg,
        "hourly": summary.get("hourly", []),
        "programs": summary.get("programs", [])[:20],
        "categories": summary.get("categories", [])[:20],
        "safeSpanSamples": summary.get("spans", [])[:80],
        "privacyNote": "Window titles and browser titles are intentionally excluded. Slack output must not include raw titles.",
    }


def dream_prompt(summary: dict[str, Any]) -> list[dict[str, str]]:
    data = json.dumps(compact_summary(summary), indent=2, sort_keys=True)
    system = (
        "You are Hermes reviewing Andrew's Chronomaxi telemetry. "
        "Spans have already been scrubbed at capture. Never include raw window titles, browser titles, or sensitive labels. "
        "Analyze productivity patterns, suggest concrete optimizations, and propose specific automatable cron jobs. "
        "Be direct, useful, lightly wry, and practical."
    )
    user = (
        "Write a markdown report with sections: Executive read, Patterns, Friction, Concrete optimizations, "
        "Automatable crons, and Tomorrow's experiment. Include exact cron command sketches when useful. "
        "Use only the sanitized aggregate and span data below.\n\n"
        f"```json\n{data}\n```"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def digest_prompt(report: str, path: Path, test_prefix: bool) -> list[dict[str, str]]:
    prefix = "[test] " if test_prefix else ""
    user = (
        "Create a Slack digest of this Chronomaxi dream report. Max 900 characters. "
        "Mention the report path exactly. Tone helpful and wry, never preachy. "
        "Do not include raw titles. Start with this exact prefix if present: "
        f"{prefix!r}. Path: {path}\n\n{report[:8000]}"
    )
    return [
        {"role": "system", "content": "You write concise Slack digests for Andrew's personal productivity system."},
        {"role": "user", "content": user},
    ]


def run(date_key: str, dry_run: bool = False, test_post: bool = False) -> dict[str, Any]:
    summary = get_day_summary(date_key)
    report = call_hermes(dream_prompt(summary), temperature=0.2)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / f"{date_key}.md"
    header = f"# Chronomaxi dream for {date_key}\n\nGenerated: {datetime.now(TZ).isoformat()}\n\n"
    path.write_text(header + report + "\n", encoding="utf-8")
    digest = call_hermes(digest_prompt(report, path, test_post), temperature=0.1)
    if test_post and not digest.startswith("[test]"):
        digest = "[test] " + digest
    if not dry_run:
        post_slack(digest, SLACK_CHANNEL)
    return {"date": date_key, "reportPath": str(path), "slackPosted": not dry_run, "spanCount": summary.get("spanAggregate", {}).get("spanCount", 0), "digest": digest}


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Chronomaxi nightly dream through Hermes")
    parser.add_argument("--date", default=yesterday_key(), help="YYYY-MM-DD, defaults to yesterday")
    parser.add_argument("--today", action="store_true", help="Use today instead of yesterday")
    parser.add_argument("--dry-run", action="store_true", help="Generate report and digest without posting to Slack")
    parser.add_argument("--test-post", action="store_true", help="Prefix Slack digest with [test]")
    args = parser.parse_args()
    date_key = today_key() if args.today else args.date
    result = run(date_key, dry_run=args.dry_run, test_post=args.test_post)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
