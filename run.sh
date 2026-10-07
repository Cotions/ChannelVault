#!/bin/bash
# ChannelVault — one-click start from source.
#
#   ./run.sh          build the UI if needed, start the backend, open the browser
#   ./run.sh --dev    same, but with the Vite dev server for hot reload
#                     (UI work only: backend refuses cross-origin API calls)
#   ./run.sh --build  rebuild the UI, then start
#
# Double-clicking this file in a file manager opens a terminal automatically.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

# --- relaunch inside a terminal when double-clicked ------------------------
# Only when there is no tty and no terminal at all, so piped or scripted runs
# (CI, `./run.sh > log`, another script) stay in place.
if ! [ -t 0 ] && ! [ -t 1 ] && [ -z "${TERM:-}" ] && [ "${CHANNELVAULT_NO_TERMINAL:-}" != "1" ]; then
  for term in gnome-terminal xfce4-terminal konsole xterm; do
    command -v "$term" &>/dev/null || continue
    case "$term" in
      gnome-terminal) exec "$term" -- bash "$0" "$@" ;;
      konsole)        exec "$term" -e bash "$0" "$@" ;;
      *)              exec "$term" -e "bash \"$0\" $*" ;;
    esac
  done
  exit 0
fi

MODE=start
for arg in "$@"; do
  case "$arg" in
    --dev)   MODE=dev ;;
    --build) MODE=build ;;
    --install-launcher) MODE=launcher ;;
  esac
done

# --- app menu entry pointing back at this script --------------------------
if [ "$MODE" = launcher ]; then
  APP_DIR="$HOME/.local/share/applications"
  ICON_DIR="$HOME/.local/share/icons/hicolor/scalable/apps"
  mkdir -p "$APP_DIR" "$ICON_DIR"
  install -m 644 "$ROOT/packaging/channelvault.svg" "$ICON_DIR/channelvault-src.svg"
  sed -e "s|__EXEC__|bash \"$ROOT/run.sh\"|" \
      -e "s|__ICON__|channelvault-src|" \
      -e "s|^Name=ChannelVault$|Name=ChannelVault (source)|" \
      -e "s|^Terminal=false$|Terminal=true|" \
      "$ROOT/packaging/ChannelVault.desktop" > "$APP_DIR/ChannelVault-source.desktop"
  command -v update-desktop-database &>/dev/null && update-desktop-database "$APP_DIR" || true
  printf '\033[1;32m▸\033[0m Added "ChannelVault (source)" to your app menu.\n'
  exit 0
fi

PORT="${CHANNELVAULT_PORT:-3360}"
VENV="$ROOT/backend/venv"
DIST="$ROOT/frontend/dist"

say() { printf '\033[1;32m▸\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

command -v python3 &>/dev/null || die "python3 not found"

# --- port check -----------------------------------------------------------
if python3 -c "import socket,sys; s=socket.socket(); sys.exit(0 if s.connect_ex(('127.0.0.1',$PORT))==0 else 1)"; then
  say "Port $PORT already in use."
  read -rp "Stop it and continue? [y/N] " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || die "Aborted."
  port_free() { ! python3 -c "import socket,sys; s=socket.socket(); sys.exit(0 if s.connect_ex(('127.0.0.1',$PORT))==0 else 1)"; }
  wait_free() { for _ in $(seq "$1"); do port_free && return 0; sleep 0.5; done; return 1; }
  # A running ChannelVault quits cleanly on request, finishing any file move
  # first. Anything else gets SIGTERM; never SIGKILL mid-write.
  curl -s -m 3 -X POST -H "X-ChannelVault: 1" "http://127.0.0.1:${PORT}/shutdown" >/dev/null 2>&1 || true
  if ! wait_free 40; then
    fuser -k -TERM "${PORT}/tcp" 2>/dev/null || true
    wait_free 20 || die "Port $PORT is still in use. Stop that process yourself, then run again."
  fi
fi

# --- python deps ----------------------------------------------------------
if [ ! -d "$VENV" ]; then
  say "Creating virtualenv"
  python3 -m venv "$VENV"
fi
if [ ! -f "$VENV/.deps-ok" ] || [ "$ROOT/backend/requirements.txt" -nt "$VENV/.deps-ok" ]; then
  say "Installing Python dependencies"
  "$VENV/bin/pip" install -q -r "$ROOT/backend/requirements.txt"
  touch "$VENV/.deps-ok"
fi

# --- frontend -------------------------------------------------------------
pkg_manager() {
  if command -v bun &>/dev/null; then echo bun
  elif command -v npm &>/dev/null; then echo npm
  else return 1; fi
}

ui_is_stale() {
  [ ! -f "$DIST/index.html" ] && return 0
  [ -n "$(find "$ROOT/frontend/src" "$ROOT/frontend/index.html" -newer "$DIST/index.html" -print -quit 2>/dev/null)" ]
}

build_ui() {
  local pm; pm="$(pkg_manager)" || die "Need bun or npm to build the UI"
  [ -d "$ROOT/frontend/node_modules" ] || { say "Installing UI dependencies ($pm)"; (cd "$ROOT/frontend" && "$pm" install); }
  say "Building UI ($pm)"
  (cd "$ROOT/frontend" && "$pm" run build)
}

if [ "$MODE" = dev ]; then
  pm="$(pkg_manager)" || die "Need bun or npm for dev mode"
  [ -d "$ROOT/frontend/node_modules" ] || (cd "$ROOT/frontend" && "$pm" install)
  say "Starting Vite dev server"
  (cd "$ROOT/frontend" && "$pm" run dev) &
  VITE_PID=$!
  trap 'kill $VITE_PID 2>/dev/null || true' EXIT
  say "Starting backend on :$PORT (UI at the Vite URL above)"
  # Not exec: the shell has to outlive the backend for the trap to stop Vite
  # (Quit in the UI ends only the backend).
  CHANNELVAULT_NO_BROWSER=1 "$VENV/bin/python" "$ROOT/backend/tracker.py"
  exit
fi

if [ "$MODE" = build ] || ui_is_stale; then
  build_ui
fi

say "Starting ChannelVault on http://localhost:$PORT"
exec "$VENV/bin/python" "$ROOT/backend/tracker.py" "$@"
