#!/bin/sh
set -eu
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'RubyCLI requer Node.js 22.16+. Instale por https://nodejs.org e execute novamente.' >&2
  exit 1
fi
ruby_source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$ruby_source_dir/scripts/install.mjs" "$@"
