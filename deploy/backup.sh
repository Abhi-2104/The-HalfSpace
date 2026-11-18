#!/usr/bin/env bash
# Consistent copy of the databases (safe while the app runs), keeps the 3 newest. Download them to your PC from time to time:
#   scp -i <key> ubuntu@<ip>:/opt/halfspace/backups/*.db .
set -euo pipefail
APP=/opt/halfspace
OUT=$APP/backups
mkdir -p "$OUT"
stamp=$(date +%Y%m%d)
sqlite3 "$APP/data/halfspace.db" ".backup '$OUT/halfspace-$stamp.db'"
sqlite3 "$APP/data/derived.db" ".backup '$OUT/derived-$stamp.db'"
cp "$APP/.env" "$OUT/env-$stamp.txt" && chmod 600 "$OUT/env-$stamp.txt"
for kind in halfspace derived env; do ls -1t "$OUT"/$kind-* 2>/dev/null | tail -n +4 | xargs -r rm -f; done
echo "backup done: $(ls -1 $OUT | wc -l) files, $(du -sh $OUT | cut -f1)"
