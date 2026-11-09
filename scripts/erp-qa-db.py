"""Disposable-only PostgreSQL QA bootstrap using the canonical test-db prelude.
No production credentials or .env files are read. Run from project root.
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONTAINER = "agent-erp-qa-20261109"
DB = "erp_qa"

def sql(text):
    p = subprocess.run(["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", DB,
                        "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
                       input=text.encode("utf-8"), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode:
        print(p.stderr.decode("utf-8", errors="replace")[-6000:])
        sys.exit(p.returncode)
    return p

if __name__ == "__main__":
    script = (ROOT / "scripts/test-db.sh").read_text(encoding="utf-8")
    prelude = script.split("psql_install <<'SQL'", 2)[2].split("\nSQL\n", 1)[0]
    # Guard against selecting any other heredoc as upstream evolves.
    assert "create schema if not exists auth" in prelude and "function auth.uid()" in prelude
    sql(prelude)
    sql((ROOT / "supabase/baseline.sql").read_text(encoding="utf-8"))
    print("ERP QA baseline install passed")
