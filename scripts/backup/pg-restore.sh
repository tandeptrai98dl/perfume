#!/usr/bin/env bash
# Restores a backup made by pg-backup.sh into a database (restore drill, disaster recovery;
# docs/ops/backup-restore.md). Refuses to overwrite a non-empty database unless --force.
#
#   RESTORE_DATABASE_URL=postgres://postgres@drill-db:5432/perfume_drill \
#   BACKUP_S3_BUCKET=perfume-backups BACKUP_S3_ENDPOINT=https://s3.vn-hcm.example \
#   BACKUP_AGE_IDENTITY=/secure/backup-key.txt \
#   scripts/backup/pg-restore.sh [latest | <s3 key, e.g. postgres/daily/perfume-…dump.age>] [--force]
#
# Requires: pg_restore/psql 17, aws CLI v2, age (for .age files).
set -euo pipefail

: "${RESTORE_DATABASE_URL:?set RESTORE_DATABASE_URL (the database to restore INTO)}"
: "${BACKUP_S3_BUCKET:?set BACKUP_S3_BUCKET}"
PREFIX="${BACKUP_S3_PREFIX:-postgres}"
TARGET="${1:-latest}"
FORCE="${2:-}"
WORK_DIR="$(mktemp -d)"
AWS_ARGS=()
if [[ -n "${BACKUP_S3_ENDPOINT:-}" ]]; then AWS_ARGS+=(--endpoint-url "$BACKUP_S3_ENDPOINT"); fi
trap 'rm -rf "$WORK_DIR"' EXIT

if [[ "$TARGET" == "latest" ]]; then
  # Newest object across daily/ and monthly/ (names sort by timestamp).
  TARGET="$(
    for folder in daily monthly; do
      aws "${AWS_ARGS[@]}" s3 ls "s3://${BACKUP_S3_BUCKET}/${PREFIX}/${folder}/" \
        | awk -v f="$folder" '$4 ~ /^perfume-.*\.dump(\.age)?$/ {print $4 " " f}'
    done | sort | tail -n 1 | awk -v p="$PREFIX" '{print p "/" $2 "/" $1}'
  )"
  [[ -n "$TARGET" ]] || { echo "restore: no backups found" >&2; exit 1; }
fi

file="$WORK_DIR/$(basename "$TARGET")"
echo "restore: downloading s3://${BACKUP_S3_BUCKET}/${TARGET}"
aws "${AWS_ARGS[@]}" s3 cp --only-show-errors "s3://${BACKUP_S3_BUCKET}/${TARGET}" "$file"
aws "${AWS_ARGS[@]}" s3 cp --only-show-errors "s3://${BACKUP_S3_BUCKET}/${TARGET}.sha256" "$file.sha256"
expected="$(cat "$file.sha256")"
actual="$(sha256sum "$file" | awk '{print $1}')"
[[ "$expected" == "$actual" ]] || { echo "restore: checksum mismatch" >&2; exit 1; }

if [[ "$file" == *.age ]]; then
  : "${BACKUP_AGE_IDENTITY:?set BACKUP_AGE_IDENTITY to the age private key file}"
  age --decrypt --identity "$BACKUP_AGE_IDENTITY" --output "${file%.age}" "$file"
  file="${file%.age}"
fi

tables="$(psql "$RESTORE_DATABASE_URL" -Atc "select count(*) from information_schema.tables where table_schema = 'public'")"
if [[ "$tables" != "0" && "$FORCE" != "--force" ]]; then
  echo "restore: target database is not empty (${tables} tables); pass --force to replace it" >&2
  exit 1
fi

echo "restore: restoring into target database"
pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error \
  --dbname="$RESTORE_DATABASE_URL" "$file"

# Quick verification for the drill log.
psql "$RESTORE_DATABASE_URL" -At <<'SQL'
select 'orders', count(*)::text from orders
union all select 'products', count(*)::text from products
union all select 'users', count(*)::text from users
union all select 'latest order', coalesce(max(placed_at)::text, '-') from orders
union all select 'migrations', count(*)::text from drizzle.__drizzle_migrations;
SQL
echo "restore: done (${TARGET})"
