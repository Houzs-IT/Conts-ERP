#!/usr/bin/env bash
# Makes one encrypted backup of the Property OS data: schema pos (every table, its data, indexes and
# checks) plus public.pos_migrations (which migrations the database has). Used by the nightly
# .github/workflows/backup.yml and, with a local database, to prove a restore works (docs/DR-RUNBOOK.md).
#
#   DB_URL=<connection string> BACKUP_PASSPHRASE=<passphrase> scripts/backup-dump.sh <out dir>
#
# Writes <out dir>/conts-pos-<UTC time>.sql.gz.enc: plain SQL (INSERT statements, so the restore needs
# no psql), with the row count of every table as trailing comments, gzipped, then encrypted with
# AES-256 (openssl enc, PBKDF2 200,000 rounds). Nothing unencrypted is left behind. Prints counts
# and sizes only, never data. PG_BIN may name the folder holding pg_dump and psql.
set -euo pipefail
: "${DB_URL:?DB_URL is not set}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"
if [ "${#BACKUP_PASSPHRASE}" -lt 12 ]; then echo "BACKUP_PASSPHRASE must be at least 12 characters." >&2; exit 1; fi
out="${1:-.}"
bin="${PG_BIN:+$PG_BIN/}"
mkdir -p "$out"
stamp="$(date -u +%Y-%m-%dT%H%MZ)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
sql="$work/conts-pos-$stamp.sql"

# Two dumps: with --table, pg_dump ignores --schema, so the migration record is dumped on its own.
"${bin}pg_dump" "$DB_URL" --schema=pos --no-owner --no-privileges --inserts --rows-per-insert=500 --file="$work/pos.sql"
"${bin}pg_dump" "$DB_URL" --table=public.pos_migrations --no-owner --no-privileges --inserts --rows-per-insert=500 --file="$work/migrations.sql"

# Exact row counts at dump time, so a restore can prove every table came back whole.
"${bin}psql" "$DB_URL" -X -q -At -F ' ' -v ON_ERROR_STOP=1 > "$work/counts.txt" <<'SQL'
SELECT format('SELECT %L, count(*) FROM %I.%I', table_schema || '.' || table_name, table_schema, table_name)
FROM information_schema.tables
WHERE (table_schema = 'pos' AND table_type = 'BASE TABLE') OR (table_schema = 'public' AND table_name = 'pos_migrations')
ORDER BY 1
\gexec
SQL

{
  echo "-- Conts ERP Property OS backup, $stamp. Restore with scripts/restore-backup.mjs (docs/DR-RUNBOOK.md)."
  cat "$work/pos.sql" "$work/migrations.sql"
  sed 's/^/-- rowcount /' "$work/counts.txt"
} > "$sql"

gzip -9 "$sql"
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -md sha256 -pass env:BACKUP_PASSPHRASE -in "$sql.gz" -out "$out/conts-pos-$stamp.sql.gz.enc"

tables="$(wc -l < "$work/counts.txt" | tr -d ' ')"
rows="$(awk '{s += $2} END {print s + 0}' "$work/counts.txt")"
echo "Backup written: conts-pos-$stamp.sql.gz.enc ($(wc -c < "$out/conts-pos-$stamp.sql.gz.enc" | tr -d ' ') bytes), $tables tables, $rows rows."
