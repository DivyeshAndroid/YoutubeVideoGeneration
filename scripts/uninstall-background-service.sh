#!/bin/zsh
set -euo pipefail

label="com.divyesh.youtube-video-generation"
target_plist="/Users/divyesh/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"

launchctl bootout "$domain/$label" 2>/dev/null || true
if test -f "$target_plist"; then
  mv "$target_plist" "/Users/divyesh/.Trash/$label.plist"
fi
