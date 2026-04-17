#!/usr/bin/env python3

from __future__ import annotations

import argparse
import datetime as dt
import glob
import json
import os
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


DEFAULT_DB_PATH = os.path.expanduser("~/.openclaw/telemetry/token-usage.sqlite")
DEFAULT_OPENCLAW_HOME = os.path.expanduser("~/.openclaw")
DEFAULT_WORKSPACE_GLOB = "/srv/openclaw/workspace-*"
SKIP_WALK_DIRS = {".git", "node_modules", "__pycache__", ".next", ".openclaw"}


@dataclass
class SessionDescriptor:
    agent_id: str
    session_id: str
    session_key: str
    session_file: str
    session_label: str | None
    surface: str | None
    provider: str | None
    chat_type: str | None
    account_id: str | None
    group_channel: str | None


def utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def iso_from_any_timestamp(value: object) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        return dt.datetime.fromtimestamp(float(value) / 1000, tz=dt.timezone.utc).replace(microsecond=0).isoformat().replace(
            "+00:00", "Z"
        )
    return None


def ensure_parent(path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)


def connect_db(db_path: str) -> sqlite3.Connection:
    ensure_parent(db_path)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    ensure_schema(conn)
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS token_usage_events (
          event_key TEXT PRIMARY KEY,
          source_kind TEXT NOT NULL,
          source_path TEXT NOT NULL,
          observed_at TEXT NOT NULL,
          ledger_date TEXT NOT NULL,
          agent_id TEXT,
          session_id TEXT,
          session_key TEXT,
          session_label TEXT,
          surface TEXT,
          chat_type TEXT,
          account_id TEXT,
          conversation_label TEXT,
          provider TEXT,
          model_name TEXT,
          model_api TEXT,
          event_type TEXT,
          message_role TEXT,
          stop_reason TEXT,
          run_status TEXT,
          profile_key TEXT,
          run_type TEXT,
          task_key TEXT,
          task_tier INTEGER,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          cached_input_tokens INTEGER NOT NULL DEFAULT 0,
          cache_write_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          total_tokens INTEGER NOT NULL DEFAULT 0,
          input_cost_usd REAL,
          cached_input_cost_usd REAL,
          cache_write_cost_usd REAL,
          output_cost_usd REAL,
          total_cost_usd REAL,
          latency_ms INTEGER,
          error_text TEXT,
          raw_json TEXT NOT NULL,
          inserted_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_token_usage_events_observed_at
          ON token_usage_events(observed_at DESC);

        CREATE INDEX IF NOT EXISTS idx_token_usage_events_agent_observed
          ON token_usage_events(agent_id, observed_at DESC);

        CREATE INDEX IF NOT EXISTS idx_token_usage_events_source_observed
          ON token_usage_events(source_kind, observed_at DESC);

        CREATE INDEX IF NOT EXISTS idx_token_usage_events_provider_model
          ON token_usage_events(provider, model_name, observed_at DESC);

        CREATE TABLE IF NOT EXISTS collector_state (
          state_key TEXT PRIMARY KEY,
          state_value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        """
    )
    conn.commit()


def get_state(conn: sqlite3.Connection, state_key: str) -> dict | None:
    row = conn.execute("SELECT state_value FROM collector_state WHERE state_key = ?", (state_key,)).fetchone()
    if row is None:
        return None
    return json.loads(row["state_value"])


def set_state(conn: sqlite3.Connection, state_key: str, value: dict) -> None:
    conn.execute(
        """
        INSERT INTO collector_state(state_key, state_value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(state_key)
        DO UPDATE SET state_value = excluded.state_value, updated_at = excluded.updated_at
        """,
        (state_key, json.dumps(value, ensure_ascii=True, sort_keys=True), utc_now_iso()),
    )


def discover_session_descriptors(openclaw_home: str) -> dict[str, SessionDescriptor]:
    descriptors: dict[str, SessionDescriptor] = {}
    agents_root = Path(openclaw_home) / "agents"
    if not agents_root.exists():
        return descriptors

    for sessions_json in agents_root.glob("*/sessions/sessions.json"):
        agent_id = sessions_json.parent.parent.name
        try:
            payload = json.loads(sessions_json.read_text())
        except (OSError, json.JSONDecodeError):
            continue

        for session_key, meta in payload.items():
            if not isinstance(meta, dict):
                continue
            session_id = meta.get("sessionId")
            session_file = meta.get("sessionFile")
            if not isinstance(session_id, str) or not isinstance(session_file, str):
                continue
            origin = meta.get("origin") if isinstance(meta.get("origin"), dict) else {}
            descriptors[session_file] = SessionDescriptor(
                agent_id=agent_id,
                session_id=session_id,
                session_key=session_key,
                session_file=session_file,
                session_label=string_or_none(meta.get("label")) or string_or_none(origin.get("label")),
                surface=string_or_none(origin.get("surface")) or string_or_none(origin.get("provider")),
                provider=string_or_none(origin.get("provider")),
                chat_type=string_or_none(meta.get("chatType")) or string_or_none(origin.get("chatType")),
                account_id=string_or_none(origin.get("accountId")),
                group_channel=string_or_none(meta.get("groupChannel")),
            )
    return descriptors


def discover_llm_run_databases(workspace_glob: str) -> list[str]:
    matches: list[str] = []
    for workspace_root in sorted(glob.glob(workspace_glob)):
        if not os.path.isdir(workspace_root):
            continue
        for root, dirs, files in os.walk(workspace_root):
            dirs[:] = [name for name in dirs if name not in SKIP_WALK_DIRS]
            for name in files:
                if not name.endswith(".sqlite"):
                    continue
                db_path = os.path.join(root, name)
                try:
                    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
                    row = conn.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'llm_runs'"
                    ).fetchone()
                    conn.close()
                except sqlite3.Error:
                    continue
                if row:
                    matches.append(db_path)
    return sorted(set(matches))


def read_file_cursor(conn: sqlite3.Connection, path: str, stat_result: os.stat_result) -> int:
    state = get_state(conn, f"cursor:file:{path}")
    if state is None:
        return 0
    same_inode = state.get("inode") == stat_result.st_ino
    same_size_or_greater = isinstance(state.get("offset"), int) and stat_result.st_size >= state["offset"]
    if same_inode and same_size_or_greater:
        return int(state["offset"])
    return 0


def write_file_cursor(conn: sqlite3.Connection, path: str, stat_result: os.stat_result, offset: int) -> None:
    set_state(
        conn,
        f"cursor:file:{path}",
        {
            "inode": stat_result.st_ino,
            "size": stat_result.st_size,
            "mtime_ns": stat_result.st_mtime_ns,
            "offset": offset,
        },
    )


def parse_openclaw_usage(usage: dict | None) -> dict | None:
    if not isinstance(usage, dict):
        return None

    input_tokens = int(number_or_zero(usage.get("input")))
    cached_input_tokens = int(number_or_zero(usage.get("cacheRead")))
    cache_write_tokens = int(number_or_zero(usage.get("cacheWrite")))
    output_tokens = int(number_or_zero(usage.get("output")))
    total_tokens = int(number_or_zero(usage.get("totalTokens")))
    cost = usage.get("cost") if isinstance(usage.get("cost"), dict) else {}
    input_cost = number_or_none(cost.get("input"))
    cached_input_cost = number_or_none(cost.get("cacheRead"))
    cache_write_cost = number_or_none(cost.get("cacheWrite"))
    output_cost = number_or_none(cost.get("output"))
    total_cost = number_or_none(cost.get("total"))

    if total_tokens == 0:
        total_tokens = input_tokens + output_tokens

    if (
        input_tokens == 0
        and cached_input_tokens == 0
        and cache_write_tokens == 0
        and output_tokens == 0
        and total_tokens == 0
        and not any(value not in (None, 0, 0.0) for value in [input_cost, cached_input_cost, cache_write_cost, output_cost, total_cost])
    ):
        return None

    return {
        "input_tokens": input_tokens,
        "cached_input_tokens": cached_input_tokens,
        "cache_write_tokens": cache_write_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
        "input_cost_usd": input_cost,
        "cached_input_cost_usd": cached_input_cost,
        "cache_write_cost_usd": cache_write_cost,
        "output_cost_usd": output_cost,
        "total_cost_usd": total_cost,
    }


def parse_news_bot_usage(token_usage_json: str | None) -> dict:
    if not token_usage_json:
        return {
            "input_tokens": 0,
            "cached_input_tokens": 0,
            "cache_write_tokens": 0,
            "output_tokens": 0,
            "total_tokens": 0,
        }

    try:
        usage = json.loads(token_usage_json)
    except json.JSONDecodeError:
        usage = {}

    input_tokens = number_or_zero(usage.get("input_tokens"))
    if input_tokens == 0:
        input_tokens = number_or_zero(usage.get("prompt_tokens"))

    output_tokens = number_or_zero(usage.get("output_tokens"))
    if output_tokens == 0:
        output_tokens = number_or_zero(usage.get("completion_tokens"))

    total_tokens = number_or_zero(usage.get("total_tokens"))
    cached_input_tokens = 0
    details = usage.get("input_tokens_details") if isinstance(usage.get("input_tokens_details"), dict) else None
    if details is None and isinstance(usage.get("prompt_tokens_details"), dict):
        details = usage.get("prompt_tokens_details")
    if isinstance(details, dict):
        cached_input_tokens = number_or_zero(details.get("cached_tokens"))

    if total_tokens == 0:
        total_tokens = max(int(input_tokens), int(cached_input_tokens)) + int(output_tokens)

    return {
        "input_tokens": int(max(input_tokens, cached_input_tokens)),
        "cached_input_tokens": int(cached_input_tokens),
        "cache_write_tokens": 0,
        "output_tokens": int(output_tokens),
        "total_tokens": int(total_tokens),
    }


def insert_event(conn: sqlite3.Connection, payload: dict) -> None:
    conn.execute(
        """
        INSERT OR IGNORE INTO token_usage_events (
          event_key,
          source_kind,
          source_path,
          observed_at,
          ledger_date,
          agent_id,
          session_id,
          session_key,
          session_label,
          surface,
          chat_type,
          account_id,
          conversation_label,
          provider,
          model_name,
          model_api,
          event_type,
          message_role,
          stop_reason,
          run_status,
          profile_key,
          run_type,
          task_key,
          task_tier,
          input_tokens,
          cached_input_tokens,
          cache_write_tokens,
          output_tokens,
          total_tokens,
          input_cost_usd,
          cached_input_cost_usd,
          cache_write_cost_usd,
          output_cost_usd,
          total_cost_usd,
          latency_ms,
          error_text,
          raw_json,
          inserted_at
        )
        VALUES (
          :event_key,
          :source_kind,
          :source_path,
          :observed_at,
          :ledger_date,
          :agent_id,
          :session_id,
          :session_key,
          :session_label,
          :surface,
          :chat_type,
          :account_id,
          :conversation_label,
          :provider,
          :model_name,
          :model_api,
          :event_type,
          :message_role,
          :stop_reason,
          :run_status,
          :profile_key,
          :run_type,
          :task_key,
          :task_tier,
          :input_tokens,
          :cached_input_tokens,
          :cache_write_tokens,
          :output_tokens,
          :total_tokens,
          :input_cost_usd,
          :cached_input_cost_usd,
          :cache_write_cost_usd,
          :output_cost_usd,
          :total_cost_usd,
          :latency_ms,
          :error_text,
          :raw_json,
          :inserted_at
        )
        """,
        payload,
    )


def sync_openclaw_sessions(conn: sqlite3.Connection, openclaw_home: str) -> tuple[int, int]:
    descriptors = discover_session_descriptors(openclaw_home)
    inserted = 0
    scanned = 0

    for session_file, descriptor in descriptors.items():
        path = Path(session_file)
        if not path.exists():
            continue
        stat_result = path.stat()
        offset = read_file_cursor(conn, session_file, stat_result)
        with path.open("rb") as handle:
            handle.seek(offset)
            while True:
                line = handle.readline()
                if not line:
                    break
                scanned += 1
                raw_line = line.decode("utf-8", errors="replace").strip()
                if not raw_line:
                    continue
                try:
                    event = json.loads(raw_line)
                except json.JSONDecodeError:
                    continue
                if event.get("type") != "message":
                    continue
                message = event.get("message")
                if not isinstance(message, dict):
                    continue
                usage = parse_openclaw_usage(message.get("usage") if isinstance(message.get("usage"), dict) else None)
                if usage is None:
                    continue
                observed_at = iso_from_any_timestamp(event.get("timestamp")) or iso_from_any_timestamp(message.get("timestamp")) or utc_now_iso()
                payload = {
                    "event_key": f"openclaw-session:{descriptor.agent_id}:{descriptor.session_id}:{event.get('id')}",
                    "source_kind": "openclaw_session",
                    "source_path": session_file,
                    "observed_at": observed_at,
                    "ledger_date": observed_at[:10],
                    "agent_id": descriptor.agent_id,
                    "session_id": descriptor.session_id,
                    "session_key": descriptor.session_key,
                    "session_label": descriptor.session_label,
                    "surface": descriptor.surface,
                    "chat_type": descriptor.chat_type,
                    "account_id": descriptor.account_id,
                    "conversation_label": descriptor.group_channel or descriptor.session_label or descriptor.session_key,
                    "provider": string_or_none(message.get("provider")),
                    "model_name": string_or_none(message.get("model")),
                    "model_api": string_or_none(message.get("api")),
                    "event_type": string_or_none(event.get("type")),
                    "message_role": string_or_none(message.get("role")),
                    "stop_reason": string_or_none(message.get("stopReason")),
                    "run_status": None,
                    "profile_key": None,
                    "run_type": None,
                    "task_key": None,
                    "task_tier": None,
                    "input_tokens": usage["input_tokens"],
                    "cached_input_tokens": usage["cached_input_tokens"],
                    "cache_write_tokens": usage["cache_write_tokens"],
                    "output_tokens": usage["output_tokens"],
                    "total_tokens": usage["total_tokens"],
                    "input_cost_usd": usage.get("input_cost_usd"),
                    "cached_input_cost_usd": usage.get("cached_input_cost_usd"),
                    "cache_write_cost_usd": usage.get("cache_write_cost_usd"),
                    "output_cost_usd": usage.get("output_cost_usd"),
                    "total_cost_usd": usage.get("total_cost_usd"),
                    "latency_ms": None,
                    "error_text": None,
                    "raw_json": raw_line,
                    "inserted_at": utc_now_iso(),
                }
                before = conn.total_changes
                insert_event(conn, payload)
                if conn.total_changes > before:
                    inserted += 1
            write_file_cursor(conn, session_file, stat_result, handle.tell())

    conn.commit()
    return inserted, scanned


def sync_llm_run_tables(conn: sqlite3.Connection, workspace_glob: str) -> tuple[int, int]:
    inserted = 0
    scanned = 0

    for db_path in discover_llm_run_databases(workspace_glob):
        cursor_key = f"cursor:llm_runs:{db_path}"
        last_seen = get_state(conn, cursor_key) or {"last_id": 0}
        last_id = int(last_seen.get("last_id", 0))

        try:
            source_conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            source_conn.row_factory = sqlite3.Row
            rows = list(
                source_conn.execute(
                    """
                    SELECT
                      id,
                      profile_key,
                      run_type,
                      task_key,
                      task_tier,
                      provider,
                      model_name,
                      started_at,
                      completed_at,
                      status,
                      latency_ms,
                      token_usage_json,
                      estimated_cost_usd,
                      error_text
                    FROM llm_runs
                    WHERE id > ?
                    ORDER BY id ASC
                    """,
                    (last_id,),
                )
            )
            source_conn.close()
        except sqlite3.Error:
            continue

        highest_id = last_id
        for row in rows:
            scanned += 1
            highest_id = max(highest_id, int(row["id"]))
            usage = parse_news_bot_usage(row["token_usage_json"])
            if usage["total_tokens"] == 0 and usage["input_tokens"] == 0 and usage["output_tokens"] == 0:
                continue
            observed_at = row["completed_at"] or row["started_at"] or utc_now_iso()
            payload = {
                "event_key": f"app-llm-run:{db_path}:{row['id']}",
                "source_kind": "app_llm_run",
                "source_path": db_path,
                "observed_at": observed_at,
                "ledger_date": observed_at[:10],
                "agent_id": None,
                "session_id": None,
                "session_key": None,
                "session_label": None,
                "surface": None,
                "chat_type": None,
                "account_id": None,
                "conversation_label": infer_app_label(db_path),
                "provider": row["provider"],
                "model_name": row["model_name"],
                "model_api": None,
                "event_type": "llm_run",
                "message_role": None,
                "stop_reason": None,
                "run_status": row["status"],
                "profile_key": row["profile_key"],
                "run_type": row["run_type"],
                "task_key": row["task_key"],
                "task_tier": row["task_tier"],
                "input_tokens": usage["input_tokens"],
                "cached_input_tokens": usage["cached_input_tokens"],
                "cache_write_tokens": usage["cache_write_tokens"],
                "output_tokens": usage["output_tokens"],
                "total_tokens": usage["total_tokens"],
                "input_cost_usd": None,
                "cached_input_cost_usd": None,
                "cache_write_cost_usd": None,
                "output_cost_usd": None,
                "total_cost_usd": row["estimated_cost_usd"],
                "latency_ms": row["latency_ms"],
                "error_text": row["error_text"],
                "raw_json": json.dumps({key: row[key] for key in row.keys()}, ensure_ascii=True, sort_keys=True),
                "inserted_at": utc_now_iso(),
            }
            before = conn.total_changes
            insert_event(conn, payload)
            if conn.total_changes > before:
                inserted += 1

        set_state(conn, cursor_key, {"last_id": highest_id})

    conn.commit()
    return inserted, scanned


def infer_app_label(db_path: str) -> str:
    normalized = db_path.replace("\\", "/")
    if "/news-bot/" in normalized:
        return "news-bot"
    return Path(db_path).stem


def print_sync_summary(conn: sqlite3.Connection, session_inserted: int, session_scanned: int, app_inserted: int, app_scanned: int) -> None:
    row = conn.execute(
        """
        SELECT
          COUNT(*) AS event_count,
          COALESCE(SUM(input_tokens), 0) AS input_tokens,
          COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
          COALESCE(SUM(output_tokens), 0) AS output_tokens,
          COALESCE(SUM(total_tokens), 0) AS total_tokens,
          COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd
        FROM token_usage_events
        """
    ).fetchone()

    print("[token-ledger sync]")
    print(f"- openclaw session events inserted: {session_inserted} (scanned lines: {session_scanned})")
    print(f"- app llm run events inserted: {app_inserted} (scanned rows: {app_scanned})")
    print(f"- ledger events total: {row['event_count']}")
    print(
        "- ledger tokens total:"
        f" input={row['input_tokens']}"
        f" cached={row['cached_input_tokens']}"
        f" output={row['output_tokens']}"
        f" total={row['total_tokens']}"
    )
    print(f"- ledger est_cost_usd total: {float(row['total_cost_usd']):.6f}")


def run_report(conn: sqlite3.Connection, days: int) -> str:
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)
    since_iso = since.replace(microsecond=0).isoformat().replace("+00:00", "Z")

    overview = conn.execute(
        """
        SELECT
          COUNT(*) AS event_count,
          COALESCE(SUM(input_tokens), 0) AS input_tokens,
          COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
          COALESCE(SUM(output_tokens), 0) AS output_tokens,
          COALESCE(SUM(total_tokens), 0) AS total_tokens,
          COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd
        FROM token_usage_events
        WHERE observed_at >= ?
        """,
        (since_iso,),
    ).fetchone()

    source_rows = conn.execute(
        """
        SELECT
          source_kind,
          COUNT(*) AS event_count,
          COALESCE(SUM(total_tokens), 0) AS total_tokens,
          COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd
        FROM token_usage_events
        WHERE observed_at >= ?
        GROUP BY source_kind
        ORDER BY total_tokens DESC, source_kind ASC
        """,
        (since_iso,),
    ).fetchall()

    consumer_rows = conn.execute(
        """
        SELECT
          COALESCE(agent_id, conversation_label, source_kind) AS label,
          COUNT(*) AS event_count,
          COALESCE(SUM(total_tokens), 0) AS total_tokens,
          COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd
        FROM token_usage_events
        WHERE observed_at >= ?
        GROUP BY label
        ORDER BY total_tokens DESC, label ASC
        LIMIT 10
        """,
        (since_iso,),
    ).fetchall()

    model_rows = conn.execute(
        """
        SELECT
          COALESCE(provider, 'unknown') AS provider,
          COALESCE(model_name, 'unknown') AS model_name,
          COUNT(*) AS event_count,
          COALESCE(SUM(total_tokens), 0) AS total_tokens,
          COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd
        FROM token_usage_events
        WHERE observed_at >= ?
        GROUP BY provider, model_name
        ORDER BY total_tokens DESC, provider ASC, model_name ASC
        LIMIT 10
        """,
        (since_iso,),
    ).fetchall()

    daily_rows = conn.execute(
        """
        SELECT
          ledger_date,
          COUNT(*) AS event_count,
          COALESCE(SUM(total_tokens), 0) AS total_tokens,
          COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd
        FROM token_usage_events
        WHERE observed_at >= ?
        GROUP BY ledger_date
        ORDER BY ledger_date DESC
        LIMIT 14
        """,
        (since_iso,),
    ).fetchall()

    lines = [
        f"[OpenClaw Token Ledger | last {days}d]",
        "",
        "Overview",
        f"- events={overview['event_count']}",
        f"- input_tokens={overview['input_tokens']}",
        f"- cached_input_tokens={overview['cached_input_tokens']}",
        f"- output_tokens={overview['output_tokens']}",
        f"- total_tokens={overview['total_tokens']}",
        f"- est_cost_usd={float(overview['total_cost_usd']):.6f}",
        "",
        "By Source",
    ]

    if source_rows:
        for row in source_rows:
            lines.append(
                f"- {row['source_kind']}: events={row['event_count']} total_tokens={row['total_tokens']} est_cost_usd={float(row['total_cost_usd']):.6f}"
            )
    else:
        lines.append("- no events")

    lines.extend(["", "Top Consumers"])
    if consumer_rows:
        for row in consumer_rows:
            lines.append(
                f"- {row['label']}: events={row['event_count']} total_tokens={row['total_tokens']} est_cost_usd={float(row['total_cost_usd']):.6f}"
            )
    else:
        lines.append("- no events")

    lines.extend(["", "Top Models"])
    if model_rows:
        for row in model_rows:
            lines.append(
                f"- {row['provider']}/{row['model_name']}: events={row['event_count']} total_tokens={row['total_tokens']} est_cost_usd={float(row['total_cost_usd']):.6f}"
            )
    else:
        lines.append("- no events")

    lines.extend(["", "Daily Totals"])
    if daily_rows:
        for row in daily_rows:
            lines.append(
                f"- {row['ledger_date']}: events={row['event_count']} total_tokens={row['total_tokens']} est_cost_usd={float(row['total_cost_usd']):.6f}"
            )
    else:
        lines.append("- no events")

    return "\n".join(lines)


def string_or_none(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def number_or_none(value: object) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    return None


def number_or_zero(value: object) -> float:
    numeric = number_or_none(value)
    return numeric if numeric is not None else 0.0


def run_sync(args: argparse.Namespace) -> int:
    conn = connect_db(args.db_path)
    try:
        session_inserted, session_scanned = sync_openclaw_sessions(conn, args.openclaw_home)
        app_inserted, app_scanned = sync_llm_run_tables(conn, args.workspace_glob)
        print_sync_summary(conn, session_inserted, session_scanned, app_inserted, app_scanned)
    finally:
        conn.close()
    return 0


def run_report_command(args: argparse.Namespace) -> int:
    conn = connect_db(args.db_path)
    try:
        print(run_report(conn, args.days))
    finally:
        conn.close()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Collect and report global OpenClaw token usage.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    sync_parser = subparsers.add_parser("sync", help="Sync OpenClaw session usage and direct llm_runs into the central ledger.")
    sync_parser.add_argument("--db-path", default=DEFAULT_DB_PATH)
    sync_parser.add_argument("--openclaw-home", default=DEFAULT_OPENCLAW_HOME)
    sync_parser.add_argument("--workspace-glob", default=DEFAULT_WORKSPACE_GLOB)
    sync_parser.set_defaults(func=run_sync)

    report_parser = subparsers.add_parser("report", help="Show a token usage summary from the central ledger.")
    report_parser.add_argument("--db-path", default=DEFAULT_DB_PATH)
    report_parser.add_argument("--days", type=int, default=7)
    report_parser.set_defaults(func=run_report_command)

    return parser


def main(argv: Iterable[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
