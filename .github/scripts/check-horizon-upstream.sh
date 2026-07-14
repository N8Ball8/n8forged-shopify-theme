#!/usr/bin/env bash

set -euo pipefail

upstream_ref="${UPSTREAM_REF:-horizon/main}"
count="$(git rev-list --count "HEAD..$upstream_ref")"
if [ "$count" -eq 0 ]; then
  echo "N8Forged is current with Horizon upstream."
  exit 0
fi

latest_sha="$(git rev-parse "$upstream_ref")"
latest_subject="$(git log -1 --format=%s "$upstream_ref")"
title="Horizon upstream update available"
existing="$(gh issue list --state open --search "$title in:title" --json number --jq '.[0].number // empty')"

if [ -z "$existing" ]; then
  gh issue create \
    --title "$title" \
    --body "The weekly monitor found **$count** upstream commit(s) not yet evaluated for N8Forged.

Latest upstream commit: \`$latest_sha\` — $latest_subject

Follow \`docs/upstream-updates.md\`. Import updates only on a feature branch, validate the development theme, and promote through the normal release workflow. This monitor never changes theme code automatically."
  exit 0
fi

body="$(gh issue view "$existing" --json body --jq .body)"
if ! grep -q "$latest_sha" <<< "$body"; then
  gh issue comment "$existing" \
    --body "Horizon advanced again: **$count** upstream commit(s) are pending. Latest: \`$latest_sha\` — $latest_subject."
fi
