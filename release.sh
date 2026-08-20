#!/bin/bash
# Cut a release: tag the current commit and push it. GitHub Actions builds the
# binary and publishes the release.
#
#   ./release.sh v0.1.0
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

VERSION="${1:-}"
say() { printf '\033[1;32m▸\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$ ]] \
  || die "Usage: ./release.sh v1.2.3"

[ -z "$(git status --porcelain)" ] || die "Working tree is dirty. Commit or stash first."
git rev-parse "$VERSION" &>/dev/null && die "Tag $VERSION already exists."

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
say "Tagging $VERSION on $BRANCH ($(git rev-parse --short HEAD))"
read -rp "Push the tag and publish a release? [y/N] " confirm
[[ "$confirm" =~ ^[Yy]$ ]] || die "Aborted."

git tag -a "$VERSION" -m "ChannelVault $VERSION"
git push origin "$BRANCH"
git push origin "$VERSION"

say "Pushed. Watch the build:"
say "  https://github.com/Cotions/ChannelVault/actions"
