from __future__ import annotations

import importlib.util
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "token_usage_ledger.py"
SPEC = importlib.util.spec_from_file_location("token_usage_ledger", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class TokenUsageLedgerTests(unittest.TestCase):
    def test_sync_openclaw_sessions_reads_usage_and_uses_cursor(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            openclaw_home = tmp / ".openclaw"
            sessions_dir = openclaw_home / "agents" / "main" / "sessions"
            sessions_dir.mkdir(parents=True)
            session_file = sessions_dir / "session-1.jsonl"
            sessions_json = sessions_dir / "sessions.json"
            session_file.write_text(
                "\n".join(
                    [
                        json.dumps({"type": "session", "id": "s1", "timestamp": "2026-04-17T00:00:00Z"}),
                        json.dumps(
                            {
                                "type": "message",
                                "id": "m1",
                                "timestamp": "2026-04-17T00:00:01Z",
                                "message": {
                                    "role": "assistant",
                                    "provider": "xai",
                                    "model": "grok-4-fast",
                                    "api": "openai-responses",
                                    "usage": {
                                        "input": 100,
                                        "output": 25,
                                        "cacheRead": 500,
                                        "cacheWrite": 0,
                                        "totalTokens": 625,
                                        "cost": {"input": 0.1, "output": 0.2, "cacheRead": 0.05, "cacheWrite": 0, "total": 0.35},
                                    },
                                    "stopReason": "stop",
                                },
                            }
                        ),
                    ]
                )
                + "\n"
            )
            sessions_json.write_text(
                json.dumps(
                    {
                        "agent:main:discord:channel:abc": {
                            "sessionId": "session-1",
                            "sessionFile": str(session_file),
                            "label": "Main channel",
                            "origin": {
                                "provider": "discord",
                                "surface": "discord",
                                "chatType": "channel",
                                "accountId": "default",
                            },
                        }
                    }
                )
            )

            db_path = tmp / "ledger.sqlite"
            conn = MODULE.connect_db(str(db_path))
            try:
                inserted, scanned = MODULE.sync_openclaw_sessions(conn, str(openclaw_home))
                self.assertEqual(inserted, 1)
                self.assertGreaterEqual(scanned, 2)

                row = conn.execute(
                    "SELECT provider, model_name, input_tokens, cached_input_tokens, output_tokens, total_tokens, conversation_label FROM token_usage_events"
                ).fetchone()
                self.assertEqual(row["provider"], "xai")
                self.assertEqual(row["model_name"], "grok-4-fast")
                self.assertEqual(row["input_tokens"], 100)
                self.assertEqual(row["cached_input_tokens"], 500)
                self.assertEqual(row["output_tokens"], 25)
                self.assertEqual(row["total_tokens"], 625)
                self.assertEqual(row["conversation_label"], "Main channel")

                with session_file.open("a") as handle:
                    handle.write(
                        json.dumps(
                            {
                                "type": "message",
                                "id": "m2",
                                "timestamp": "2026-04-17T00:01:00Z",
                                "message": {
                                    "role": "assistant",
                                    "provider": "xai",
                                    "model": "grok-4-fast",
                                    "api": "openai-responses",
                                    "usage": {"input": 10, "output": 5, "cacheRead": 20, "cacheWrite": 0, "totalTokens": 35},
                                },
                            }
                        )
                        + "\n"
                    )

                inserted_again, _ = MODULE.sync_openclaw_sessions(conn, str(openclaw_home))
                self.assertEqual(inserted_again, 1)
                count = conn.execute("SELECT COUNT(*) AS c FROM token_usage_events").fetchone()["c"]
                self.assertEqual(count, 2)
            finally:
                conn.close()

    def test_sync_llm_run_tables_imports_direct_app_runs(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            workspace_root = tmp / "srv" / "openclaw" / "workspace-personal" / "projects" / "opensec" / "news-bot" / "data"
            workspace_root.mkdir(parents=True)
            source_db_path = workspace_root / "news-bot.sqlite"
            source_conn = sqlite3.connect(source_db_path)
            source_conn.execute(
                """
                CREATE TABLE llm_runs (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  profile_key TEXT,
                  run_type TEXT,
                  task_key TEXT,
                  task_tier INTEGER,
                  provider TEXT,
                  model_name TEXT,
                  started_at TEXT,
                  completed_at TEXT,
                  status TEXT,
                  latency_ms INTEGER,
                  token_usage_json TEXT,
                  estimated_cost_usd REAL,
                  error_text TEXT
                )
                """
            )
            source_conn.execute(
                """
                INSERT INTO llm_runs (
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
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "tech",
                    "item_enrichment",
                    "digest.am",
                    1,
                    "openai",
                    "gpt-5.4-mini",
                    "2026-04-17T00:00:00Z",
                    "2026-04-17T00:00:05Z",
                    "ok",
                    5000,
                    json.dumps(
                        {
                            "input_tokens": 250,
                            "output_tokens": 40,
                            "total_tokens": 290,
                            "input_tokens_details": {"cached_tokens": 50},
                        }
                    ),
                    0.0123,
                    None,
                ),
            )
            source_conn.commit()
            source_conn.close()

            db_path = tmp / "ledger.sqlite"
            conn = MODULE.connect_db(str(db_path))
            try:
                inserted, scanned = MODULE.sync_llm_run_tables(conn, str(tmp / "srv" / "openclaw" / "workspace-*"))
                self.assertEqual(inserted, 1)
                self.assertEqual(scanned, 1)

                row = conn.execute(
                    "SELECT source_kind, conversation_label, provider, model_name, profile_key, run_type, input_tokens, cached_input_tokens, output_tokens, total_tokens, total_cost_usd FROM token_usage_events"
                ).fetchone()
                self.assertEqual(row["source_kind"], "app_llm_run")
                self.assertEqual(row["conversation_label"], "news-bot")
                self.assertEqual(row["provider"], "openai")
                self.assertEqual(row["model_name"], "gpt-5.4-mini")
                self.assertEqual(row["profile_key"], "tech")
                self.assertEqual(row["run_type"], "item_enrichment")
                self.assertEqual(row["input_tokens"], 250)
                self.assertEqual(row["cached_input_tokens"], 50)
                self.assertEqual(row["output_tokens"], 40)
                self.assertEqual(row["total_tokens"], 290)
                self.assertAlmostEqual(row["total_cost_usd"], 0.0123)

                inserted_again, scanned_again = MODULE.sync_llm_run_tables(conn, str(tmp / "srv" / "openclaw" / "workspace-*"))
                self.assertEqual(inserted_again, 0)
                self.assertEqual(scanned_again, 0)
            finally:
                conn.close()


if __name__ == "__main__":
    unittest.main()
