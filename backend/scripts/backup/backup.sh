#!/usr/bin/env bash
# Daily database backup.
#   DATABASE_URL  database to back up (required)
#   BACKUP_DIR    where dumps go (default ./backups; on Railway use a mounted volume)
#   KEEP_DAYS     how many days of dumps to keep (default 14)
# Run once a day (Railway cron service: `bash scripts/backup/backup.sh`).
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
out="$BACKUP_DIR/tova-ster-$stamp.dump"
# Custom format: compressed, and restorable table by table if ever needed.
pg_dump --format=custom --no-owner --no-privileges --file="$out.partial" "$DATABASE_URL"
mv "$out.partial" "$out"
# Keep a small checksum next to it so a damaged file is spotted before a restore.
sha256sum "$out" > "$out.sha256"
find "$BACKUP_DIR" -name 'tova-ster-*.dump*' -type f -mtime +"$KEEP_DAYS" -delete
echo "Backup written: $out ($(du -h "$out" | cut -f1))"
