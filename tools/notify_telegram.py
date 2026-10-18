"""Send the scheduled crawl result to Telegram (env TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID).

Missing credentials only print a warning: notifications must never fail the workflow.
"""
from __future__ import annotations

import argparse
import html
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


AUTOMATION_DIR = Path(__file__).resolve().parents[1] / "data" / "automation"
KST = ZoneInfo("Asia/Seoul")
STATUS_ICON = {"success": "✅", "partial_success": "⚠️", "failure": "❌"}
STATUS_TEXT = {"success": "성공", "partial_success": "일부 성공", "failure": "실패"}


def _kst(iso: str | None) -> str:
    if not iso:
        return "-"
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(KST).strftime("%Y-%m-%d %H:%M")


def _minutes(start: str | None, end: str | None) -> str:
    if not start or not end:
        return "-"
    delta = datetime.fromisoformat(end.replace("Z", "+00:00")) - datetime.fromisoformat(start.replace("Z", "+00:00"))
    return f"{round(delta.total_seconds() / 60)}분"


def build_message(
    title: str,
    summary: dict | None,
    failed_steps: list[str],
    dashboard_url: str = "",
    run_url: str = "",
) -> str:
    esc = html.escape
    status = (summary or {}).get("status", "failure")
    if failed_steps:
        status = "failure"
    lines = [f"{STATUS_ICON[status]} <b>{esc(title)}</b> {STATUS_TEXT[status]}"]

    if summary:
        lines.append(
            f"{_kst(summary.get('started_at'))} KST · {summary.get('published')}/{summary.get('total')} 게시"
            f" · {_minutes(summary.get('started_at'), summary.get('finished_at'))}"
        )
        by_site: dict[str, list[str]] = {}
        problems = []
        skipped: dict[str, list[str]] = {}
        for r in summary.get("results", []):
            ok = r["status"] in ("published", "crawled")
            mark = "" if ok else "🚫" if r["status"] in ("blocked", "skipped_site_blocked") else "⚠️"
            by_site.setdefault(r["site"], []).append(f"{r['country']} {r['item_count']}{mark}")
            if r["status"] == "skipped_site_blocked":
                skipped.setdefault(r["site"], []).append(r["country"])
            elif not ok:
                problems.append(f"• {r['site']}/{r['country']} {r['status']}: {r.get('reason') or '-'}")
        lines.append("")
        lines += [f"<b>{esc(site)}</b>: {esc(' · '.join(parts))}" for site, parts in by_site.items()]
        for site in summary.get("blocked_sites", []):
            rest = ", ".join(skipped.get(site, []))
            lines += ["", f"🚫 <b>{esc(site)} 차단 감지</b> (봇 확인/접속 제한 페이지) — "
                          + (f"남은 국가 수집 중단: {esc(rest)}" if rest else "이후 수집 중단") + ". 기존 대시보드 데이터는 유지됩니다."]
        if problems:
            lines += ["", *map(esc, problems)]
    else:
        lines.append("수집 요약(last_run.json)이 없습니다. 수집 단계 이전에 실패했습니다.")

    if failed_steps:
        lines += ["", f"❌ 실패한 단계: {esc(', '.join(failed_steps))} (데이터 커밋/배포가 안 됐을 수 있음)"]
    links = []
    if dashboard_url:
        links.append(f'<a href="{esc(dashboard_url)}">대시보드</a>')
    if run_url:
        links.append(f'<a href="{esc(run_url)}">실행 로그</a>')
    if links:
        lines += ["", " · ".join(links)]
    return "\n".join(lines)


def send(text: str) -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        print("::warning::TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set; skipping Telegram notification")
        return False
    body = urllib.parse.urlencode(
        {"chat_id": chat_id, "text": text, "parse_mode": "HTML", "disable_web_page_preview": "true"}
    ).encode()
    try:
        with urllib.request.urlopen(f"https://api.telegram.org/bot{token}/sendMessage", body, timeout=20) as res:
            ok = json.load(res).get("ok", False)
    except Exception as exc:  # never fail the workflow on a notification error
        print(f"::warning::Telegram send failed: {type(exc).__name__}")
        return False
    print("Telegram notification sent" if ok else "::warning::Telegram API returned ok=false")
    return ok


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--title", default="eSIMPriceJapan 격주 수집")
    parser.add_argument("--summary", type=Path, default=AUTOMATION_DIR / "last_run.json")
    parser.add_argument("--since", default="", help="ignore a summary older than this ISO time (stale commit)")
    parser.add_argument("--step", action="append", default=[], help="name=outcome (failure is reported)")
    parser.add_argument("--dashboard-url", default="")
    parser.add_argument("--run-url", default="")
    parser.add_argument("--test", action="store_true", help="send a test message")
    parser.add_argument("--print", action="store_true", help="print the message instead of sending")
    args = parser.parse_args(argv)

    if args.test:
        text = f"🔔 <b>{html.escape(args.title)}</b> 텔레그램 알림 테스트"
    else:
        summary = json.loads(args.summary.read_text(encoding="utf-8")) if args.summary.exists() else None
        if summary and args.since and summary.get("started_at", "") < args.since:
            summary = None
        failed = [name for name, _, outcome in (s.partition("=") for s in args.step) if outcome == "failure"]
        text = build_message(args.title, summary, failed, args.dashboard_url, args.run_url)
    if args.print:
        print(text)
        return 0
    send(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
