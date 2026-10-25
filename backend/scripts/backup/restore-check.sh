#!/usr/bin/env bash
# Proves the latest backup can be restored: restores it into a scratch
# database and compares row counts of the key tables with the live database.
#   DATABASE_URL          live database (read only here)
#   RESTORE_DATABASE_URL  an EMPTY scratch database the check may overwrite
#   BACKUP_DIR            where backup.sh writes (default ./backups)
# Never point RESTORE_DATABASE_URL at the live database.
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL}"
: "${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL (an empty scratch database)}"
if [ "$DATABASE_URL" = "$RESTORE_DATABASE_URL" ]; then echo "Refusing: the scratch database is the live database." >&2; exit 1; fi
BACKUP_DIR="${BACKUP_DIR:-./backups}"
latest="$(ls -1t "$BACKUP_DIR"/tova-ster-*.dump 2>/dev/null | head -1 || true)"
[ -n "$latest" ] || { echo "No backup found in $BACKUP_DIR" >&2; exit 1; }
sha256sum -c "$latest.sha256" >/dev/null || { echo "Checksum does not match: $latest" >&2; exit 1; }
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$RESTORE_DATABASE_URL" "$latest"
fail=0
for t in users products orders order_items payments points_ledger events newsletter_subscribers carts cart_items site_settings; do
  live=$(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM $t")
  restored=$(psql "$RESTORE_DATABASE_URL" -Atc "SELECT count(*) FROM $t")
  # The live database may have grown since the backup; restored must not exceed it.
  if [ "$restored" -gt "$live" ]; then echo "MISMATCH $t: restored $restored > live $live"; fail=1; else echo "ok  $t: restored $restored (live now $live)"; fi
done
[ "$fail" = 0 ] && echo "Restore check passed: $latest" || { echo "Restore check FAILED" >&2; exit 1; }
