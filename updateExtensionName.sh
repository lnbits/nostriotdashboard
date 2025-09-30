#!/usr/bin/env bash
# Usage: ./rename-plugin.sh oldname:newname [old2:new2 ...]
set -euo pipefail

# Fail if no args
if [ "$#" -eq 0 ]; then
  echo "Usage: $0 old:new [old2:new2 ...]" >&2
  exit 1
fi

# Function to rename files, contents, and directories
rename_pair() {
  local OLD="$1"
  local NEW="$2"

  echo "🔁 Replacing '$OLD' with '$NEW'..."

  # 1) Rename files with OLD in the *filename*
  # Use NUL separation to handle spaces/newlines
  find . -type f -not -path "*/.git/*" -name "*${OLD}*" -print0 |
    while IFS= read -r -d '' file; do
      dir=$(dirname "$file")
      base=$(basename "$file")
      new_base="${base//$OLD/$NEW}"
      new_path="$dir/$new_base"
      if [ "$file" != "$new_path" ]; then
        mv -v -- "$file" "$new_path"
      fi
    done

  # 2) Replace inside file *contents* (portable, works on macOS and Linux)
  # perl \Q...\E safely escapes regex metacharacters in $OLD
  # Skip .git directory
  find . -type f -not -path "*/.git/*" -print0 |
    xargs -0 perl -pi -e "s/\Q${OLD}\E/${NEW}/g"

  # 3) Rename directories (bottom-up so children move before parents)
  find . -depth -type d -not -path "*/.git/*" -name "*${OLD}*" -print0 |
    while IFS= read -r -d '' dir; do
      parent=$(dirname "$dir")
      base=$(basename "$dir")
      new_base="${base//$OLD/$NEW}"
      new_path="$parent/$new_base"
      if [ "$dir" != "$new_path" ]; then
        mv -v -- "$dir" "$new_path"
      fi
    done
}

# Main loop over all name pairs
for pair in "$@"; do
  OLD="${pair%%:*}"
  NEW="${pair##*:}"

  if [ -z "$OLD" ] || [ -z "$NEW" ] || [ "$OLD" = "$NEW" ]; then
    echo "Skipping invalid pair: '$pair'" >&2
    continue
  fi

  rename_pair "$OLD" "$NEW"
done

echo "✅ All done, with .git folder safely ignored."