#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# If not running in a terminal, relaunch inside one
if ! [ -t 0 ]; then
  if command -v gnome-terminal &>/dev/null; then
    gnome-terminal -- bash "$0"
  elif command -v xfce4-terminal &>/dev/null; then
    xfce4-terminal -e "bash \"$0\""
  elif command -v xterm &>/dev/null; then
    xterm -e "bash \"$0\""
  fi
  exit 0
fi

cd "$SCRIPT_DIR"

PORT=3360
PID=$(fuser ${PORT}/tcp 2>/dev/null | tr -d ' ')

if [ -n "$PID" ]; then
  echo "Port ${PORT} is already in use by PID ${PID}."
  read -p "Kill it and continue? [y/N] " confirm
  if [[ "$confirm" =~ ^[Yy]$ ]]; then
    kill "$PID" && echo "Killed PID ${PID}." || { echo "Failed to kill process."; exit 1; }
    sleep 1
  else
    echo "Aborting."
    exit 1
  fi
fi

if [ ! -d "venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv venv
  venv/bin/pip install -r requirements.txt
fi

venv/bin/python tracker.py
