#!/bin/bash
# Kept for compatibility — the launcher now lives at the repo root.
exec bash "$(cd "$(dirname "$0")/.." && pwd)/run.sh" "$@"
