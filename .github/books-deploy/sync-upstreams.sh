#!/bin/sh
# Pulls both upstreams into this fork and rebuilds books-deploy from them.
#
#   seerr-team/seerr  main          -> main (mirror) -> sync/upstream-main
#   jabloink/seerr    feat-readarr  -> feat-readarr (mirror, PR base)
#
# books-deploy then merges feat-readarr, sync/upstream-main and every fix/* and
# feature/* branch on origin. Pushing books-deploy starts the image build.
#
# Mirrors only ever fast-forward. A merge that conflicts stops the script with
# the conflict left in place; resolve it, commit, and run the script again.
#
#   .github/books-deploy/sync-upstreams.sh          # merge locally, push nothing
#   .github/books-deploy/sync-upstreams.sh --push   # also push what changed
set -eu

push=false
[ "${1:-}" = "--push" ] && push=true

ensure_remote() {
  git remote get-url "$1" >/dev/null 2>&1 || git remote add "$1" "$2"
}

ensure_remote seerr-upstream https://github.com/seerr-team/seerr.git
ensure_remote seerr-books-upstream https://github.com/jabloink/seerr.git

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "working tree has uncommitted changes - commit or stash them first" >&2
  exit 1
fi

git fetch --prune origin
git fetch seerr-upstream main
git fetch seerr-books-upstream feat-readarr

mirror() {
  branch=$1
  upstream=$2
  if ! git merge-base --is-ancestor "origin/$branch" "$upstream" 2>/dev/null; then
    if git rev-parse --verify -q "origin/$branch" >/dev/null; then
      echo "origin/$branch has commits $upstream does not - it is no longer a mirror" >&2
      exit 1
    fi
  fi
  echo "$branch <- $upstream ($(git rev-list --count "origin/$branch..$upstream" 2>/dev/null || echo new) new)"
  if $push; then
    git push origin "$upstream:refs/heads/$branch"
  fi
}

mirror main seerr-upstream/main
mirror feat-readarr seerr-books-upstream/feat-readarr

merge_into() {
  target=$1
  shift
  git switch -q "$target"
  git merge -q --ff-only "origin/$target"
  for source in "$@"; do
    if git merge-base --is-ancestor "$source" HEAD; then
      continue
    fi
    name=$(echo "$source" | sed -E 's#^(origin|seerr-upstream|seerr-books-upstream)/##')
    echo "merging $source into $target"
    git merge --no-ff -m "Merge branch '$name' into $target" "$source"
  done
  if $push; then
    git push origin "$target"
  fi
}

merge_into sync/upstream-main seerr-upstream/main

branches=$(git for-each-ref --format='%(refname:short)' \
  refs/remotes/origin/fix refs/remotes/origin/feature)

# shellcheck disable=SC2086
merge_into books-deploy seerr-books-upstream/feat-readarr sync/upstream-main $branches

echo "books-deploy is up to date$($push && echo ' and pushed' || echo ' locally - rerun with --push to publish')"
