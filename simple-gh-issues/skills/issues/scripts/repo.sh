#!/usr/bin/env bash
# Print owner/name of the current repository, or a notice when it cannot be resolved.
gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null \
  || echo "(取得できなかった: GitHub リポジトリでないか、gh が未認証)"
