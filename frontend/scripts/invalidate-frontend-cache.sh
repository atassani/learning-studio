#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "❌ Error on line $LINENO"; exit 1' ERR

AWS_PAGER=""
export AWS_PAGER

DISTRIBUTION_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Aliases.Items[?@=='humblyproud.com']].Id" \
  --output text --no-cli-pager)

if [[ -z "$DISTRIBUTION_ID" || "$DISTRIBUTION_ID" == "None" ]]; then
  echo "❌ Could not resolve CloudFront distribution for alias humblyproud.com"
  exit 1
fi

echo "CloudFront distribution: $DISTRIBUTION_ID"

aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/studio" "/studio/" "/studio/index.html"

echo "✅ HTML invalidation submitted"
