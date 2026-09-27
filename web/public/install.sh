#!/bin/sh
# upm installer for macOS, Linux and other POSIX systems.
#
#   curl -fsSL https://upm.sh/install.sh | sh
#
# Checks for Node.js and npm, then runs `npm i -g upm`. Arguments go to npm:
#
#   curl -fsSL https://upm.sh/install.sh | sh -s -- --prefix ~/.local
#
# Everything is inside main(), called on the last line, so a download cut short cannot
# run half a script.

set -eu

# `process.getBuiltinModule`, which upm loads every builtin through.
NODE_MIN_MAJOR=22
NODE_MIN_MINOR=3

err() {
  echo "upm install: $*" >&2
  exit 1
}

main() {
  command -v node >/dev/null 2>&1 ||
    err "Node.js $NODE_MIN_MAJOR.$NODE_MIN_MINOR+ is required: https://nodejs.org/en/download"
  command -v npm >/dev/null 2>&1 ||
    err "npm is required; it ships with Node.js: https://nodejs.org/en/download"

  version=$(node --version)
  version=${version#v}
  major=${version%%.*}
  rest=${version#*.}
  minor=${rest%%.*}
  if [ "$major" -lt "$NODE_MIN_MAJOR" ] ||
    { [ "$major" -eq "$NODE_MIN_MAJOR" ] && [ "$minor" -lt "$NODE_MIN_MINOR" ]; }; then
    err "Node.js $NODE_MIN_MAJOR.$NODE_MIN_MINOR+ is required, found $version: https://nodejs.org/en/download"
  fi

  # `--min-release-age 0` lets npm install a release published moments ago.
  npm i -g upm --min-release-age 0 "$@"
}

main "$@"
