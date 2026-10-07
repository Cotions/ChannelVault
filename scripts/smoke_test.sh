#!/bin/bash
# Start a built ChannelVault binary against a throwaway config and check the
# API's guards (header, host allowlist, id validation, no CORS) and quit.
# Used by CI on every push and by the release workflow before publishing.
#
#   scripts/smoke_test.sh ./dist/channelvault
set -euo pipefail
BIN="${1:?usage: smoke_test.sh <path to channelvault binary>}"
PORT="${SMOKE_PORT:-3399}"
WORK="$(mktemp -d)"
mkdir -p "$WORK/watch" "$WORK/data"
cat > "$WORK/config.json" <<EOF
{"watch_directory":"$WORK/watch","data_directory":"$WORK/data","media_roots":[]}
EOF

"$BIN" --version

CHANNELVAULT_CONFIG="$WORK/config.json" \
CHANNELVAULT_PORT="$PORT" \
CHANNELVAULT_NO_BROWSER=1 \
"$BIN" &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT

# /config needs the header: without it the poll only ever sees 403.
up=0
for _ in $(seq 1 30); do
  if curl -sf -o /dev/null -H 'X-ChannelVault: 1' "http://localhost:$PORT/config"; then up=1; break; fi
  sleep 1
done
[ "$up" = 1 ] || { echo "✗ server did not come up on port $PORT"; exit 1; }

fail=0
H='X-ChannelVault: 1'
# expect <code> <path> [curl args...]
expect() {
  want=$1; path=$2; shift 2
  code=$(curl -s -o /dev/null -w '%{http_code}' "$@" "http://localhost:$PORT$path")
  if [ "$code" != "$want" ]; then echo "✗ $path → $code (want $want)"; fail=1; else echo "✓ $path → $code"; fi
}

echo "-- public by URL alone"
expect 200 /                       -H 'Accept: text/html'
expect 200 /playlists              -H 'Accept: text/html'
expect 200 /artist/Example         -H 'Accept: text/html'
expect 200 /channelvault.user.js

echo "-- API needs the header"
expect 200 /videos                 -H "$H"
expect 200 /config                 -H "$H"
expect 200 /playlists              -H "$H"
expect 403 /videos
expect 403 /config
expect 403 /organize/preview
expect 403 /browse
expect 403 /config                 -X POST -H 'Content-Type: application/json' -d '{}'
expect 403 /scan                   -X POST
expect 403 /shutdown               -X POST
expect 403 /videos/aaaaaaaaaaa     -X DELETE
expect 200 /mark/aaaaaaaaaaa       -X DELETE -H "$H"

echo "-- host allowlist blocks DNS rebinding"
expect 403 /config                 -H "$H" -H 'Host: evil.example'
expect 403 /config                 -H "$H" -H 'Host: 127.0.0.1.nip.io:$PORT'

echo "-- video ids must be 11 url-safe chars"
expect 404 /check-video/..         -H "$H" --path-as-is
expect 404 /thumb/short            -H "$H"
expect 200 /check-video/aaaaaaaaaaa -H "$H"
expect 400 /videos/manual          -X POST -H "$H" -H 'Content-Type: application/json' -d '{"video_id":"../etc"}'

echo "-- tags and segments sit behind the header too"
expect 403 /tags
expect 200 /tags                   -H "$H"
expect 200 /tags                   -H 'Accept: text/html'
expect 403 /segments/backfill      -X POST
expect 200 /tags                   -X POST -H "$H" -H 'Content-Type: application/json' -d '{"name":"smoke"}'
expect 400 /tags                   -X POST -H "$H" -H 'Content-Type: application/json' -d '{"name":""}'
expect 404 /videos/aaaaaaaaaaa/segments -X POST -H "$H" -H 'Content-Type: application/json' -d '{"start_secs":0,"end_secs":5}'
expect 200 /videos/aaaaaaaaaaa/segments -H "$H"

echo "-- audio tracks: header for the API, URL alone for the stream"
expect 403 /videos/aaaaaaaaaaa/audio-tracks
expect 200 /videos/aaaaaaaaaaa/audio-tracks -H "$H"
expect 400 /videos/aaaaaaaaaaa/audio-tracks -X POST -H "$H" -H 'Content-Type: application/json' -d '{"file_path":"/etc/passwd"}'
expect 404 /audio-track/999999

echo "-- no CORS grant, ever"
if curl -s -D - -o /dev/null -H 'Origin: http://evil.example' -H "$H" http://localhost:$PORT/config \
     | grep -qi 'access-control-allow'; then echo "✗ CORS header present"; fail=1; else echo "✓ no CORS headers"; fi

# The SPA fetches JSON from the same paths the router also renders.
[ "$(curl -s -H "$H" http://localhost:$PORT/playlists)" = "[]" ] \
  || { echo "✗ /playlists did not return JSON for fetch"; fail=1; }

# Last, because it takes the server down: the quit button's endpoint.
echo "-- quit stops the process"
expect 200 /shutdown               -X POST -H "$H"
for _ in $(seq 1 10); do kill -0 $PID 2>/dev/null || break; sleep 1; done
if kill -0 $PID 2>/dev/null; then echo "✗ still running after /shutdown"; fail=1; else echo "✓ exited after /shutdown"; fi

exit $fail
