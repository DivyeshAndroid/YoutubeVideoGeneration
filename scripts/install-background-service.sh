#!/bin/zsh
set -euo pipefail

label="com.divyesh.youtube-video-generation"
project_dir="/Users/divyesh/Projects/YoutubeVideoGeneration"
source_plist="$project_dir/scripts/$label.plist"
target_plist="/Users/divyesh/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"

mkdir -p "$project_dir/work" "/Users/divyesh/Library/LaunchAgents"
plutil -lint "$source_plist"
cp "$source_plist" "$target_plist"
chmod 600 "$target_plist"

launchctl bootout "$domain/$label" 2>/dev/null || true
launchctl bootstrap "$domain" "$target_plist"
launchctl enable "$domain/$label"
launchctl print "$domain/$label"
