#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "❌ Error on line $LINENO"; exit 1' ERR

# Validates typecheck, format and tests: no suprises
npm run check

# Using production environment variables
npm run build

AWS_PAGER=""
export AWS_PAGER
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export SCRIPT_DIR
OUT_DIR="$SCRIPT_DIR/../out"
export OUT_DIR

BUCKET="studio.humblyproud.com"
export BUCKET

# Phase 1 deploy: upload new build WITHOUT delete.
# This keeps older hashed chunks available for active sessions and avoids
# edge/Lambda bursts after broad invalidations.
aws s3 sync "$OUT_DIR" "s3://$BUCKET/" --exclude ".DS_Store"

# Invalidate only entry HTML routes. Do not invalidate /studio/_next/*.
"$SCRIPT_DIR/invalidate-frontend-cache.sh"

echo "✅ Phase 1 deployment complete"
echo "ℹ️  Cleanup phase (delete old assets) should be run later, after cache/session drain."
echo "ℹ️  Recommended: run ./scripts/cleanup-frontend-assets.sh around 24h after deployment."
