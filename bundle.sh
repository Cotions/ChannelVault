#!/bin/bash
# ChannelVault — build one self-contained executable.
#
#   ./bundle.sh             build ./dist/channelvault
#   ./bundle.sh --install   build, then install to ~/.local/bin + app menu entry
#   ./bundle.sh --uninstall remove the installed copy (leaves your data alone)
#
# The binary embeds the Flask backend, the built React UI and the userscript.
# It reads config from ~/.config/channelvault/config.json and keeps the DB in
# whatever data_directory that config points at, so it never writes next to itself.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
VENV="$ROOT/backend/venv"
OUT="$ROOT/dist/channelvault"

BIN_DIR="$HOME/.local/bin"
ICON_DIR="$HOME/.local/share/icons/hicolor/scalable/apps"
APP_DIR="$HOME/.local/share/applications"

say() { printf '\033[1;32m▸\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$BIN_DIR/channelvault" "$ICON_DIR/channelvault.svg" "$APP_DIR/ChannelVault.desktop"
  command -v update-desktop-database &>/dev/null && update-desktop-database "$APP_DIR" || true
  say "Uninstalled. Your config and database were left untouched."
  exit 0
fi

# --- 1. build the UI ------------------------------------------------------
if command -v bun &>/dev/null; then PM=bun
elif command -v npm &>/dev/null; then PM=npm
else die "Need bun or npm to build the UI"; fi

[ -d "$ROOT/frontend/node_modules" ] || { say "Installing UI dependencies ($PM)"; (cd "$ROOT/frontend" && "$PM" install); }
say "Building UI ($PM)"
(cd "$ROOT/frontend" && "$PM" run build)
[ -f "$ROOT/frontend/dist/index.html" ] || die "UI build produced no index.html"

# --- 2. build the binary --------------------------------------------------
[ -d "$VENV" ] || { say "Creating virtualenv"; python3 -m venv "$VENV"; }
say "Installing build dependencies"
"$VENV/bin/pip" install -q -r "$ROOT/backend/requirements.txt" -r "$ROOT/packaging/requirements-build.txt"

say "Freezing with PyInstaller (this takes a minute)"
rm -rf "$ROOT/build" "$ROOT/dist"
"$VENV/bin/pyinstaller" \
  --distpath "$ROOT/dist" \
  --workpath "$ROOT/build" \
  --noconfirm --clean \
  "$ROOT/packaging/channelvault.spec"

[ -f "$OUT" ] || die "Build failed: $OUT not found"
say "Built $OUT ($(du -h "$OUT" | cut -f1))"

# --- 3. optional install --------------------------------------------------
if [ "${1:-}" = "--install" ]; then
  mkdir -p "$BIN_DIR" "$ICON_DIR" "$APP_DIR"
  install -m 755 "$OUT" "$BIN_DIR/channelvault"
  install -m 644 "$ROOT/packaging/channelvault.svg" "$ICON_DIR/channelvault.svg"
  sed -e "s|__EXEC__|$BIN_DIR/channelvault|" \
      -e "s|__ICON__|channelvault|" \
      "$ROOT/packaging/ChannelVault.desktop" > "$APP_DIR/ChannelVault.desktop"
  chmod 644 "$APP_DIR/ChannelVault.desktop"
  command -v update-desktop-database &>/dev/null && update-desktop-database "$APP_DIR" || true
  # Seed the user config from this checkout on first install so the installed
  # binary keeps pointing at the same watch folder and data directory.
  USER_CFG="${XDG_CONFIG_HOME:-$HOME/.config}/channelvault/config.json"
  if [ -f "$ROOT/backend/config.json" ] && [ ! -f "$USER_CFG" ]; then
    mkdir -p "$(dirname "$USER_CFG")"
    cp "$ROOT/backend/config.json" "$USER_CFG"
    say "Seeded config at $USER_CFG"
  fi
  say "Installed. Launch it from your app menu, or run: channelvault"
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) printf '\033[1;33m!\033[0m %s is not on your PATH.\n' "$BIN_DIR" ;;
  esac
else
  say "Run it:            $OUT"
  say "Install it:        ./bundle.sh --install"
fi
