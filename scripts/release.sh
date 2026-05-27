#!/bin/bash
set -e

echo "=== Claude Code SDK Release Script ==="

# Determine release type
RELEASE_TYPE="${1:-patch}"

case "$RELEASE_TYPE" in
  patch|minor|major)
    echo "→ Release type: $RELEASE_TYPE"
    ;;
  *)
    echo "Usage: $0 {patch|minor|major}"
    echo "  patch  - bug fixes (default)"
    echo "  minor  - new features, backward compatible"
    echo "  major  - breaking changes"
    exit 1
    ;;
esac

echo ""
echo "[1/4] Running tests..."
npm test

echo ""
echo "[2/4] Bumping version ($RELEASE_TYPE)..."
npm version "$RELEASE_TYPE" --no-git-tag-version

echo ""
echo "[3/4] Building..."
npm run build

echo ""
echo "[4/4] Publishing to npm..."
npm publish

echo ""
echo "=== Release complete ==="
