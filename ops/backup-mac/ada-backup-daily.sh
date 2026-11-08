#!/bin/zsh
# V2 — daily encrypted backup of the Production database from the owner's Mac (Neon Free; no paid service, no third party).
# NOT INSTALLED by the repository: the owner installs it (fr.accesdirectaide.backup.plist) after a separate authorization.
# - The connection string of a READ-ONLY Neon role is read from the macOS Keychain (never a file, never the shell history):
#     security add-generic-password -a ada -s ada-neon-readonly -w        (prompts, hidden)
# - Backups are encrypted with the PUBLIC key (ADAB2): this Mac cannot read them; the private key stays offline.
# - Missed runs (Mac off / asleep / offline) and failures raise a macOS notification and leave a marker; the status file says the newest backup age.
set -u
setopt NULL_GLOB   # an empty backup folder is not an error (first run)
umask 077
REPO="${ADA_REPO:-$HOME/Projects/ADA_CLAUDE_LAB/CLEAN_EXPORT_R24/deploy}"
OUT="${ADA_BACKUP_DIR:-$HOME/ADA-Backups/prod}"
PUB="${ADA_BACKUP_PUBLIC_KEY_FILE:-$HOME/ADA-Backups/backup-public.pem}"
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@18/bin}"
STATUS="$OUT/STATUS.json"; FAILMARK="$OUT/LAST_FAILURE"
MIN_FREE_GB=2; MAX_AGE_H=36
# LAB drill only: ADA_NOTIFY=0 prints instead of notifying; ADA_LAB_DATABASE_URL (127.0.0.1 only) replaces the Keychain entry
notify() { [[ "${ADA_NOTIFY:-1}" == 0 ]] && { print -r -- "NOTIFY: $1"; return 0; }; /usr/bin/osascript -e "display notification \"$1\" with title \"AccesDirectAide — sauvegarde\" sound name \"Basso\"" >/dev/null 2>&1 || true; }
fail() { print -r -- "$(date -u +%FT%TZ) $1" > "$FAILMARK"; notify "ÉCHEC : $1"; exit 1; }
mkdir -p "$OUT"
# 1. missed-run detection: the newest backup must be < 36 h old (checked BEFORE today's run)
newest=$(ls -t "$OUT"/*.dump.enc 2>/dev/null | head -1)
if [[ -n "$newest" ]]; then
  age_h=$(( ( $(date +%s) - $(stat -f %m "$newest") ) / 3600 ))
  (( age_h > MAX_AGE_H )) && notify "Sauvegarde manquée : la dernière date de ${age_h} h. Une nouvelle est lancée."
fi
# 2. preconditions
[[ -x "$PG_BIN/pg_dump" ]] || fail "pg_dump 18 introuvable ($PG_BIN) : brew install postgresql@18"
[[ -r "$PUB" ]] || fail "clé publique introuvable ($PUB)"
free_gb=$(df -g "$OUT" | awk 'NR==2 {print $4}')
(( free_gb >= MIN_FREE_GB )) || fail "espace disque insuffisant (${free_gb} Go libres)"
[[ -n "${ADA_LAB_DATABASE_URL:-}" ]] || /usr/bin/nc -z -G 5 1.1.1.1 443 >/dev/null 2>&1 || fail "pas de connexion réseau"
if [[ -n "${ADA_LAB_DATABASE_URL:-}" ]]; then
  [[ "$ADA_LAB_DATABASE_URL" == postgres://*@127.0.0.1:* ]] || fail "ADA_LAB_DATABASE_URL : 127.0.0.1 seulement"
  DBURL="$ADA_LAB_DATABASE_URL"
else
  DBURL=$(/usr/bin/security find-generic-password -a ada -s ada-neon-readonly -w 2>/dev/null) || fail "identifiant Neon absent du trousseau (ada-neon-readonly)"
fi
# 3. backup (the connection string goes through the environment of ONE process, never an argument)
cd "$REPO" || fail "dépôt introuvable ($REPO)"
res=$(env -i PATH="/usr/bin:/bin:/opt/homebrew/bin" HOME="$HOME" PG_BIN="$PG_BIN" DATABASE_URL="$DBURL" BACKUP_PUBLIC_KEY="$(cat "$PUB")" \
  node scripts/db-backup.mjs --out "$OUT" --label prod 2>&1) || { unset DBURL; fail "pg_dump ou chiffrement : $(print -r -- "$res" | tail -1 | cut -c1-120)"; }
unset DBURL
file=$(print -r -- "$res" | /usr/bin/sed -n 's/.*"file":"\([^"]*\)".*/\1/p')
node scripts/db-backup.mjs --check-header "$file" >/dev/null 2>&1 || fail "contrôle de l’en-tête refusé"
# 4. rotation: 35 days (privacy notice § 4), nothing older
node scripts/db-backup.mjs --list "$OUT" --prune --keep-days 35 --keep-weekly 0 >/dev/null 2>&1 || fail "rotation"
rm -f "$FAILMARK"
print -r -- "{\"lastSuccess\":\"$(date -u +%FT%TZ)\",\"file\":\"$(basename "$file")\",\"bytes\":$(stat -f %z "$file"),\"count\":$(ls "$OUT"/*.dump.enc | wc -l | tr -d ' ')}" > "$STATUS"
