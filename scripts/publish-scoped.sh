#!/usr/bin/env bash
# Publish a release tag under an npm scope, to the registry mapped to that
# scope in the user's npmrc (`@scope:registry=...`).
#
# Usage: scripts/publish-scoped.sh @scope vX.Y.Z [--dry-run]
set -euo pipefail

usage="usage: $0 @scope vX.Y.Z [--dry-run]"

fail() {
  echo "publish-scoped: $*" >&2
  exit 1
}

positional=()
publish_args=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) publish_args+=(--dry-run) ;;
    -*) fail "unknown option: $arg" ;;
    *) positional+=("$arg") ;;
  esac
done
[ "${#positional[@]}" -eq 2 ] || fail "$usage"

scope=${positional[0]}
[[ "$scope" == @?* && "$scope" != */* ]] || fail "expected a scope like @name, got '$scope'"
tag=${positional[1]}
[[ "$tag" == v* ]] || fail "expected a release tag like v1.2.3, got '$tag'"

repo=$(git rev-parse --show-toplevel)
git -C "$repo" rev-parse -q --verify "refs/tags/$tag" >/dev/null || fail "no such tag: $tag"

registry=$(npm config get "$scope:registry")
if [ -z "$registry" ] || [ "$registry" = undefined ]; then
  fail "$scope:registry is not set in your npmrc"
fi

tmp=$(mktemp -d)
work="$tmp/strongbus"
cleanup() {
  git -C "$repo" worktree remove --force "$work" 2>/dev/null || true
  rm -rf "$tmp"
}
trap cleanup EXIT

git -C "$repo" worktree add --quiet --detach "$work" "$tag"
cd "$work"

name=$(node -p "require('./package.json').name")
version=$(node -p "require('./package.json').version")
[ "v$version" = "$tag" ] || fail "package.json version $version does not match tag $tag"

target="$scope/${name##*/}"
if [ -n "$(npm view "$target@$version" version --registry "$registry" 2>/dev/null)" ]; then
  fail "$target@$version is already published to $registry"
fi

if [[ "$version" == *-* ]]; then
  prerelease=${version#*-}
  publish_args+=(--tag "${prerelease%%.*}")
fi

npm pkg set name="$target"
npm pkg delete publishConfig
yarn install --frozen-lockfile --ignore-scripts --silent

echo "Publishing $target@$version from $tag to $registry"
npm publish --registry "$registry" "${publish_args[@]}"
