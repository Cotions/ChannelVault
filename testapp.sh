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

# Without bwrap nothing stops the test instance writing to real files, so that
# takes an explicit --no-sandbox rather than a warning.
if [ "$MODE" != status ] && [ "$SANDBOX" = yes ] && ! command -v bwrap &>/dev/null; then
  die "bwrap not found. Install bubblewrap, or pass --no-sandbox to run without the read-only protection."
fi

[ -f "$LIVE_CONFIG" ] || die "No live config at $LIVE_CONFIG. Start the real app once first."

# --- read the live config; each profile's test copy sits beside it with a -test suffix ---
# Old configs are flat; newer ones hold a list of profiles, each its own library.
PROFILES_PY='
import json, sys
c = json.load(open(sys.argv[1]))
profiles = c.get("profiles") or [{"id": "default", **{k: c[k] for k in ("watch_directory", "data_directory", "media_roots") if k in c}}]
active = next((p for p in profiles if p.get("id") == c.get("active_profile")), profiles[0])
'

read -r LIVE_DATA LIVE_WATCH < <(
  python3 -c "$PROFILES_PY
print(active[\"data_directory\"], active.get(\"watch_directory\", \"\"))" "$LIVE_CONFIG"
)
TEST_DATA="${CHANNELVAULT_TEST_DATA:-${LIVE_DATA%/}-test}"

[ "$TEST_DATA" != "$LIVE_DATA" ] || die "Test data dir must differ from the live one ($LIVE_DATA)."

# The other profiles' databases, copied the same way: "<live> <test>" per line.
mapfile -t OTHER_DATA < <(
  python3 -c "$PROFILES_PY
for p in profiles:
    if p is not active and p.get(\"data_directory\"):
        d = p[\"data_directory\"].rstrip(\"/\")
        print(d + \"\\t\" + d + \"-test\")" "$LIVE_CONFIG"
)

# Every folder the app may read media from, across all profiles, so the
# sandbox can seal them.
mapfile -t MEDIA_ROOTS < <(
  python3 -c "$PROFILES_PY
import os
roots = []
for p in profiles:
    roots += list(p.get(\"media_roots\") or [])
    if p.get(\"watch_directory\"):
        roots.append(p[\"watch_directory\"])
seen = set()
for r in roots:
    r = str(r).strip()
    if r and r not in seen and os.path.isdir(r):
        seen.add(r)
        print(r)" "$LIVE_CONFIG"
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

if [ "$MODE" = reset ]; then
  if [ -d "$TEST_DATA" ]; then
    say "Removing the old copy at $TEST_DATA"
    rm -rf "$TEST_DATA"
  fi
  for pair in "${OTHER_DATA[@]}"; do
    IFS=$'\t' read -r _live test <<< "$pair"
    [ -d "$test" ] && { say "Removing the old copy at $test"; rm -rf "$test"; }
  done
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
for pair in "${OTHER_DATA[@]}"; do
  IFS=$'\t' read -r live test <<< "$pair"
  if [ -f "$live/videos.db" ] && [ ! -f "$test/videos.db" ]; then
    say "Copying profile data $live to $test"
    mkdir -p "$test"
    cp -a --reflink=auto "$live/." "$test/"
  fi
done

# --- write the test config (never config.json, so the live app can't see it) --
python3 - "$TEST_CONFIG" "$LIVE_CONFIG" "$TEST_DATA" <<'PY'
import json, sys
out, live, data = sys.argv[1], sys.argv[2], sys.argv[3]
c = json.load(open(live))
if c.get("profiles"):
    # Every profile gets its own copy; the active one may be overridden.
    for p in c["profiles"]:
        if p.get("id") == c.get("active_profile") or len(c["profiles"]) == 1:
            p["data_directory"] = data
        elif p.get("data_directory"):
            p["data_directory"] = p["data_directory"].rstrip("/") + "-test"
else:
    c["data_directory"] = data      # the only difference: its own database
json.dump(c, open(out, "w"), indent=2)
PY
say "Test config at $TEST_CONFIG (data_directory → $TEST_DATA)"

# --- UI must be built from the current source -----------------------------
# Testing UI changes against an old build tests nothing, so rebuild when any
# source file is newer than the build.
DIST="$ROOT/frontend/dist"
if [ ! -f "$DIST/index.html" ] || \
   [ -n "$(find "$ROOT/frontend/src" "$ROOT/frontend/index.html" -newer "$DIST/index.html" -print -quit 2>/dev/null)" ]; then
  if command -v bun &>/dev/null; then PM=bun
  elif command -v npm &>/dev/null; then PM=npm
  else die "UI build is missing or stale and neither bun nor npm is installed."; fi
  [ -d "$ROOT/frontend/node_modules" ] || { say "Installing UI dependencies ($PM)"; (cd "$ROOT/frontend" && "$PM" install); }
  say "UI source changed since the last build: rebuilding ($PM)"
  (cd "$ROOT/frontend" && "$PM" run build)
fi
[ -x "$VENV/bin/python" ] || die "No virtualenv at $VENV. Run ./run.sh once."

if python3 -c "import socket,sys; s=socket.socket(); sys.exit(0 if s.connect_ex(('127.0.0.1',$PORT))==0 else 1)"; then
  die "Port $PORT is already in use. Set CHANNELVAULT_TEST_PORT to something else."
fi

# --- launch ----------------------------------------------------------------
CMD=(env "CHANNELVAULT_CONFIG=$TEST_CONFIG" "CHANNELVAULT_PORT=$PORT" "CHANNELVAULT_NO_BROWSER=1"
     "$VENV/bin/python" "$ROOT/backend/tracker.py")

if [ "$SANDBOX" = yes ]; then
  # Bind everything as normal, then re-bind the folders we must not damage as
  # read-only. Later binds win, so those paths become unwritable for this
  # process only — reading and streaming still work.
  RO=()
  for r in "${MEDIA_ROOTS[@]}"; do RO+=(--ro-bind "$r" "$r"); done
  [ -d "$LIVE_DATA" ] && RO+=(--ro-bind "$LIVE_DATA" "$LIVE_DATA")
  for pair in "${OTHER_DATA[@]}"; do
    IFS=$'\t' read -r live _test <<< "$pair"
    [ -d "$live" ] && RO+=(--ro-bind "$live" "$live")
  done
  RO+=(--ro-bind "$LIVE_CONFIG" "$LIVE_CONFIG")
  say "Sandbox on: media and the live database are read-only for this instance"
  CMD=(bwrap --dev-bind / / "${RO[@]}" --die-with-parent "${CMD[@]}")
else
  warn "Sandbox disabled: this instance CAN write to your real files"
fi

say "Test instance → http://localhost:$PORT   (live app stays on 3360)"
exec "${CMD[@]}"
