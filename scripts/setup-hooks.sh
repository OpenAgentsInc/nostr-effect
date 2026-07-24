#!/bin/bash
# Install pre-push hook into the real git dir (works for worktrees where .git is a file).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
git_dir="$(git -C "$root" rev-parse --git-dir)"
mkdir -p "$git_dir/hooks"
cp "$root/scripts/pre-push" "$git_dir/hooks/pre-push"
chmod +x "$git_dir/hooks/pre-push"
echo "Installed pre-push hook into $git_dir/hooks/pre-push"
