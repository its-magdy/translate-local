#!/usr/bin/env bash
# Publishes one npm package directory, safe to re-run.
# Usage: scripts/npm-publish.sh <package-dir>
#
# - Already on the registry: skip.
# - npm says the version is already published (E403 "cannot publish over")
#   or still staged (E409 "previously staged"): treat as published. A staged
#   version can take minutes to show up on the registry, and a retry would
#   hit the same error forever.
# - Any other failure (trusted publisher missing or misconfigured, network): exit 1.
set -euo pipefail

dir="$1"
name=$(node -p "require('./$dir/package.json').name")
version=$(node -p "require('./$dir/package.json').version")

# npm publish ships "workspace:*" verbatim, which no installer can resolve.
# scripts/stage-npm-packages.mjs replaces it with the release version.
if grep -q '"workspace:' "$dir/package.json"; then
  echo "::error::$dir/package.json still has a workspace: dependency. Run scripts/stage-npm-packages.mjs first."
  exit 1
fi

if npm view "$name@$version" version >/dev/null 2>&1; then
  echo "$name@$version is already on the registry, skipping"
  exit 0
fi

if out=$(cd "$dir" && npm publish --access public --provenance 2>&1); then
  echo "$out"
  echo "Published $name@$version"
  exit 0
fi

echo "$out"
if grep -qE "cannot publish over the previously published version|previously staged version" <<<"$out"; then
  echo "$name@$version was already published (or is still staged), continuing"
  exit 0
fi

echo "::error::npm publish failed for $name@$version"
exit 1
