#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/sistema_distribuidora}"
DB_FILE="${DB_FILE:-$APP_DIR/backend/banco.sqlite}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/sistema_distribuidora}"
KEEP_DAYS="${KEEP_DAYS:-15}"

timestamp="$(date +%Y%m%d-%H%M%S)"
backup_file="$BACKUP_DIR/banco-$timestamp.sqlite"

if [ ! -f "$DB_FILE" ]; then
  echo "Banco nao encontrado: $DB_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_FILE" ".backup '$backup_file'"
else
  cp "$DB_FILE" "$backup_file"
fi

gzip -f "$backup_file"

find "$BACKUP_DIR" -name "banco-*.sqlite.gz" -type f -mtime +"$KEEP_DAYS" -delete

echo "Backup criado: $backup_file.gz"
