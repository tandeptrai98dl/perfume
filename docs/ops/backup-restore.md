# Backups and restore drill

ARCHITECTURE.md §4.2 / §12 "Operations": daily backups + PITR with 14-day retention, and a
restore drill every quarter (go-live gate: one passed drill).

## Layers

| Layer | What | Retention | Restores to |
| --- | --- | --- | --- |
| Provider PITR | Managed PostgreSQL snapshots + WAL | 14 days | any second in the window, new instance |
| `scripts/backup/pg-backup.sh` | `pg_dump -Fc`, encrypted with `age`, uploaded to a **separate** S3 bucket (other account/region of the provider, versioning + object lock if offered) | 14 daily + 12 monthly (1st of month) | any PostgreSQL 17 |
| Media bucket | Product images (re-creatable from originals) | bucket versioning 30 days | same bucket |

Dumps contain personal data: encrypt with `BACKUP_AGE_RECIPIENT`; the private key is kept
offline by the owner (password manager + printed copy), never on the VM.

## Schedule the backup (VM)

```bash
# /etc/cron.d/perfume-backup — 02:15 Asia/Ho_Chi_Minh (19:15 UTC), mails on failure
MAILTO=ops@example.vn
15 19 * * * deploy . /etc/perfume/backup.env && /opt/perfume/scripts/backup/pg-backup.sh >> /var/log/perfume-backup.log 2>&1
```

`/etc/perfume/backup.env` (mode 600):

```bash
export BACKUP_DATABASE_URL=postgres://backup_ro:…@db.internal:5432/perfume?sslmode=require
export BACKUP_S3_BUCKET=perfume-backups
export BACKUP_S3_ENDPOINT=https://s3.example-provider.vn
export AWS_ACCESS_KEY_ID=…        # key limited to the backup bucket
export AWS_SECRET_ACCESS_KEY=…
export BACKUP_AGE_RECIPIENT=age1…
# optional: BACKUP_S3_PREFIX=postgres BACKUP_RETENTION_DAYS=14 BACKUP_MONTHLY_RETENTION_MONTHS=12
```

Read-only role for the dump:

```sql
create role backup_ro login password '…';
grant pg_read_all_data to backup_ro;
```

Tools on the VM: `postgresql-client-17`, AWS CLI v2, `age`.

## Restore

```bash
RESTORE_DATABASE_URL=postgres://postgres:…@drill-db:5432/perfume_drill \
BACKUP_S3_BUCKET=perfume-backups BACKUP_S3_ENDPOINT=https://s3.example-provider.vn \
BACKUP_AGE_IDENTITY=/secure/perfume-backup.key \
scripts/backup/pg-restore.sh latest            # or a key: postgres/daily/perfume-2026-…dump.age
```

The script verifies the SHA-256, decrypts, refuses a non-empty target unless `--force`,
restores with `pg_restore --clean --if-exists --no-owner --exit-on-error` and prints row
counts and the migration count. For production disaster recovery prefer provider PITR (no
data loss up to the failure); use the dump when the provider/account itself is lost.

## Quarterly restore drill — checklist

Record date, operator, backup key, timings and results in the drill log.

- [ ] Pick the latest **daily** dump and one **monthly** dump (alternate each quarter).
- [ ] Create an empty PostgreSQL 17 database on a separate instance (never production).
- [ ] Run `pg-restore.sh`; time it (RTO target: database restored < 1 h).
- [ ] Compare the printed counts with production at backup time (orders, products, users);
      latest `placed_at` is within 24 h of the backup time (RPO for dumps: 24 h; PITR: minutes).
- [ ] Migration count equals `src/server/db/migrations/meta/_journal.json` entries of the
      deployed release.
- [ ] Start a web container against the restored DB (staging env, payment simulator, no
      real e-mail): home, a PDP and `/admin/login` load; an admin can open an order.
- [ ] Run one PITR restore in the provider console to a timestamp and check an order created
      just before it exists.
- [ ] Confirm the backup bucket retention: oldest daily ≤ 15 days, monthly ≤ 12 months.
- [ ] Destroy the drill database and its credentials (it holds personal data).
- [ ] File issues for anything that failed; the go-live gate needs one fully passed drill.
