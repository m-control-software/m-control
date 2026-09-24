"""Build a fixture Options+ store: <dir>/settings.db with the real table layout.

    python make_store.py <store.json> <dir>
"""
import json
import sqlite3
import sys
from pathlib import Path


def make_store(doc_path: Path, target_dir: Path) -> Path:
    doc = json.loads(doc_path.read_text(encoding="utf-8"))
    target_dir.mkdir(parents=True, exist_ok=True)
    db = target_dir / "settings.db"
    con = sqlite3.connect(db)
    con.execute("PRAGMA journal_mode=WAL")  # as the agent runs it
    con.execute("CREATE TABLE data(_id INTEGER PRIMARY KEY,_date_created datetime default current_timestamp,"
                "file BLOB NOT NULL)")
    con.execute("CREATE TABLE snapshots(_id INTEGER PRIMARY KEY,_date_created datetime default current_timestamp,"
                "uuid TEXT NOT NULL,label TEXT NOT NULL,file BLOB NOT NULL)")
    blob = json.dumps(doc, indent=2, ensure_ascii=False, sort_keys=True).encode("utf-8")
    con.execute("INSERT INTO data(_id, file) VALUES (1, ?)", (blob,))
    con.commit()
    con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    con.close()
    return db


if __name__ == "__main__":
    print(make_store(Path(sys.argv[1]), Path(sys.argv[2])))
