#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "❌ Error on line $LINENO"; exit 1' ERR

AWS_PAGER=""
export AWS_PAGER

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$SCRIPT_DIR/../out"
BUCKET="studio.humblyproud.com"

if [[ ! -d "$OUT_DIR" ]]; then
  echo "❌ Build output not found at $OUT_DIR"
  echo "Run npm run build first."
  exit 1
fi

# Phase 2 cleanup: reconcile bucket to the latest build and delete stale objects.
# Run this after enough time has passed for old sessions/caches to drain.
aws s3 sync "$OUT_DIR" "s3://$BUCKET/" --delete --exclude ".DS_Store"

echo "✅ Cleanup sync complete (stale assets deleted)"
echo "ℹ️  You can run ./scripts/invalidate-frontend-cache.sh if you also changed HTML entry points."
