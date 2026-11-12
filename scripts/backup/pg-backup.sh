#!/usr/bin/env bash
# Daily PostgreSQL backup to S3-compatible object storage (ARCHITECTURE.md §4.2, §12
# "Operations"; docs/ops/backup-restore.md). Complements the managed database's own
# snapshots + PITR: this copy lives in a different bucket/account and is what the quarterly
# restore drill uses.
#
#   BACKUP_DATABASE_URL=postgres://backup_ro@db:5432/perfume \
#   BACKUP_S3_BUCKET=perfume-backups BACKUP_S3_ENDPOINT=https://s3.vn-hcm.example \
#   BACKUP_AGE_RECIPIENT=age1... scripts/backup/pg-backup.sh
#
# Requires: pg_dump (same major as the server, 17), aws CLI v2, optionally age.
# Credentials: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (a key that can only write/list/
# delete in the backup bucket). Exit code ≠ 0 on any failure, so cron/systemd can alert.
set -euo pipefail

: "${BACKUP_DATABASE_URL:?set BACKUP_DATABASE_URL (read-only role is enough)}"
: "${BACKUP_S3_BUCKET:?set BACKUP_S3_BUCKET}"
PREFIX="${BACKUP_S3_PREFIX:-postgres}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
MONTHLY_RETENTION_MONTHS="${BACKUP_MONTHLY_RETENTION_MONTHS:-12}"
WORK_DIR="${BACKUP_WORK_DIR:-$(mktemp -d)}"
AWS_ARGS=()
if [[ -n "${BACKUP_S3_ENDPOINT:-}" ]]; then AWS_ARGS+=(--endpoint-url "$BACKUP_S3_ENDPOINT"); fi

cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
day="$(date -u +%d)"
kind="daily"
[[ "$day" == "01" ]] && kind="monthly"
file="perfume-${stamp}.dump"

echo "backup: dumping database (${kind})"
# Custom format: compressed, restorable table by table; no owners/ACLs so it restores into
# any role on a fresh instance.
pg_dump --format=custom --compress=9 --no-owner --no-acl \
  --dbname="$BACKUP_DATABASE_URL" --file="$WORK_DIR/$file"

# Sanity check: the archive must list its contents (catches truncated dumps).
pg_restore --list "$WORK_DIR/$file" > /dev/null

if [[ -n "${BACKUP_AGE_RECIPIENT:-}" ]]; then
  # Dumps contain personal data (Decree 356/2025): encrypt before they leave the VM.
  age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$WORK_DIR/$file.age" "$WORK_DIR/$file"
  rm "$WORK_DIR/$file"
  file="$file.age"
fi

sha256sum "$WORK_DIR/$file" | awk '{print $1}' > "$WORK_DIR/$file.sha256"
key="${PREFIX}/${kind}/${file}"
echo "backup: uploading s3://${BACKUP_S3_BUCKET}/${key}"
aws "${AWS_ARGS[@]}" s3 cp --only-show-errors "$WORK_DIR/$file" "s3://${BACKUP_S3_BUCKET}/${key}"
aws "${AWS_ARGS[@]}" s3 cp --only-show-errors "$WORK_DIR/$file.sha256" "s3://${BACKUP_S3_BUCKET}/${key}.sha256"

# Retention: daily dumps for RETENTION_DAYS, monthly (1st of the month) for
# MONTHLY_RETENTION_MONTHS. Prefer bucket lifecycle rules too; this keeps it explicit.
prune() {
  local folder="$1" cutoff="$2"
  aws "${AWS_ARGS[@]}" s3 ls "s3://${BACKUP_S3_BUCKET}/${PREFIX}/${folder}/" | while read -r _ _ _ name; do
    [[ "$name" =~ ^perfume-([0-9]{4}-[0-9]{2}-[0-9]{2})T ]] || continue
    if [[ "${BASH_REMATCH[1]}" < "$cutoff" ]]; then
      echo "backup: removing ${folder}/${name}"
      aws "${AWS_ARGS[@]}" s3 rm --only-show-errors "s3://${BACKUP_S3_BUCKET}/${PREFIX}/${folder}/${name}"
    fi
  done
}
prune daily "$(date -u -d "-${RETENTION_DAYS} days" +%Y-%m-%d)"
prune monthly "$(date -u -d "-${MONTHLY_RETENTION_MONTHS} months" +%Y-%m-%d)"

echo "backup: done ${key}"
