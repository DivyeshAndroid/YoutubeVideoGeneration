#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h:h}"
cd "$project_dir"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required: https://nodejs.org/" >&2
  exit 1
fi

node_major="$(node -p 'Number(process.versions.node.split(`.`)[0])')"
if (( node_major < 20 )); then
  echo "Node.js 20+ is required; found $(node --version)." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required." >&2
  exit 1
fi

npm ci
mkdir -p output work secrets

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example. Review provider and upload settings before running."
else
  echo "Existing .env preserved."
fi

npm run check
echo "Bootstrap complete. Run 'npm run doctor' to validate configured services."
