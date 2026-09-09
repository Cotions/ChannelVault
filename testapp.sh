#!/bin/bash
# ChannelVault — run a throwaway instance against a COPY of your database.
#
#   ./testapp.sh            start the test instance (copies the DB on first run)
#   ./testapp.sh --reset    throw the copy away and take a fresh one from live
#   ./testapp.sh --status   show what exists and where, then exit
#   ./testapp.sh --no-sandbox   skip the read-only protection (not recommended)
#
# Your videos are SHARED with the live app; your database is NOT.
#
# The test instance reads its own config file, so the live app never sees it,
# and it writes its database to its own folder. On top of that it runs inside
# a bubblewrap sandbox where your media folders and your live database folder
# are mounted read-only, so a bug (or an experiment with the organise/enrich
# tools) physically cannot move, rename or overwrite a real file.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}/channelvault"
LIVE_CONFIG="$CONFIG_HOME/config.json"
TEST_CONFIG="$CONFIG_HOME/config.test.json"
PORT="${CHANNELVAULT_TEST_PORT:-3399}"
VENV="$ROOT/backend/venv"

say()  { printf '\033[1;32m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

MODE=start
for arg in "$@"; do
  case "$arg" in
    --reset)      MODE=reset ;;
    --status)     MODE=status ;;
    --no-sandbox) SANDBOX=no ;;
    --help|-h)    sed -n '2,14p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) die "Unknown option: $arg (try --help)" ;;
  esac
done
SANDBOX="${SANDBOX:-yes}"

[ -f "$LIVE_CONFIG" ] || die "No live config at $LIVE_CONFIG. Start the real app once first."

# --- read the live config; the test copy sits beside it with a -test suffix ---
read -r LIVE_DATA LIVE_WATCH < <(
  python3 - "$LIVE_CONFIG" <<'PY'
import json, sys
c = json.load(open(sys.argv[1]))
print(c["data_directory"], c.get("watch_directory", ""))
PY
)
TEST_DATA="${CHANNELVAULT_TEST_DATA:-${LIVE_DATA%/}-test}"

[ "$TEST_DATA" != "$LIVE_DATA" ] || die "Test data dir must differ from the live one ($LIVE_DATA)."

# Every folder the app may read media from, so the sandbox can seal them.
mapfile -t MEDIA_ROOTS < <(
  python3 - "$LIVE_CONFIG" <<'PY'
import json, os, sys
c = json.load(open(sys.argv[1]))
roots = list(c.get("media_roots") or [])
if c.get("watch_directory"):
    roots.append(c["watch_directory"])
seen = set()
for r in roots:
    r = str(r).strip()
    if r and r not in seen and os.path.isdir(r):
        seen.add(r)
        print(r)
PY
)

if [ "$MODE" = status ]; then
  echo "live config   $LIVE_CONFIG"
  echo "live data     $LIVE_DATA"
  echo "test config   $TEST_CONFIG $([ -f "$TEST_CONFIG" ] && echo '(exists)' || echo '(not created yet)')"
  echo "test data     $TEST_DATA $([ -d "$TEST_DATA" ] && echo "($(du -sh "$TEST_DATA" 2>/dev/null | cut -f1))" || echo '(not created yet)')"
  echo "test port     $PORT"
  echo "shared, read-only in the sandbox:"
  printf '              %s\n' "${MEDIA_ROOTS[@]}"
  exit 0
fi

if [ "$MODE" = reset ] && [ -d "$TEST_DATA" ]; then
  say "Removing the old copy at $TEST_DATA"
  rm -rf "$TEST_DATA"
fi

# --- take the copy ---------------------------------------------------------
if [ ! -f "$TEST_DATA/videos.db" ]; then
  [ -f "$LIVE_DATA/videos.db" ] || die "No database at $LIVE_DATA/videos.db"
  say "Copying your database and thumbnails to $TEST_DATA ($(du -sh "$LIVE_DATA" | cut -f1))"
  mkdir -p "$TEST_DATA"
  # -a keeps timestamps; the live folder is only ever read here.
  cp -a --reflink=auto "$LIVE_DATA/." "$TEST_DATA/"
  say "Copied. The live database was not modified."
fi

# --- write the test config (never config.json, so the live app can't see it) --
python3 - "$TEST_CONFIG" "$LIVE_CONFIG" "$TEST_DATA" <<'PY'
import json, sys
out, live, data = sys.argv[1], sys.argv[2], sys.argv[3]
c = json.load(open(live))
c["data_directory"] = data          # the only difference: its own database
json.dump(c, open(out, "w"), indent=2)
PY
say "Test config at $TEST_CONFIG (data_directory → $TEST_DATA)"

# --- UI must be built, same as the live app --------------------------------
[ -f "$ROOT/frontend/dist/index.html" ] || die "UI not built. Run: cd frontend && bun run build"
[ -x "$VENV/bin/python" ] || die "No virtualenv at $VENV. Run ./run.sh once."

if python3 -c "import socket,sys; s=socket.socket(); sys.exit(0 if s.connect_ex(('127.0.0.1',$PORT))==0 else 1)"; then
  die "Port $PORT is already in use. Set CHANNELVAULT_TEST_PORT to something else."
fi

# --- launch ----------------------------------------------------------------
CMD=(env "CHANNELVAULT_CONFIG=$TEST_CONFIG" "CHANNELVAULT_PORT=$PORT" "CHANNELVAULT_NO_BROWSER=1"
     "$VENV/bin/python" "$ROOT/backend/tracker.py")

if [ "$SANDBOX" = yes ] && command -v bwrap &>/dev/null; then
  # Bind everything as normal, then re-bind the folders we must not damage as
  # read-only. Later binds win, so those paths become unwritable for this
  # process only — reading and streaming still work.
  RO=()
  for r in "${MEDIA_ROOTS[@]}"; do RO+=(--ro-bind "$r" "$r"); done
  [ -d "$LIVE_DATA" ] && RO+=(--ro-bind "$LIVE_DATA" "$LIVE_DATA")
  RO+=(--ro-bind "$LIVE_CONFIG" "$LIVE_CONFIG")
  say "Sandbox on: media and the live database are read-only for this instance"
  CMD=(bwrap --dev-bind / / "${RO[@]}" --die-with-parent "${CMD[@]}")
else
  [ "$SANDBOX" = yes ] && warn "bwrap not found — running without the read-only protection"
  [ "$SANDBOX" = no ]  && warn "Sandbox disabled: this instance CAN write to your real files"
fi

say "Test instance → http://localhost:$PORT   (live app stays on 3360)"
exec "${CMD[@]}"
