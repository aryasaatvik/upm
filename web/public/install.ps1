# upm installer for Windows.
#
#   irm https://upm.sh/install.ps1 | iex
#
# Checks for Node.js and npm, then runs `npm i -g upm`.

$ErrorActionPreference = 'Stop'

# `process.getBuiltinModule`, which upm loads every builtin through.
$nodeMinMajor = 22
$nodeMinMinor = 3

# `throw` rather than `exit`, so an `irm | iex` run does not close the user's session.
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "upm install: Node.js $nodeMinMajor.$nodeMinMinor+ is required: https://nodejs.org/en/download"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw 'upm install: npm is required; it ships with Node.js: https://nodejs.org/en/download'
}

$version = (& node --version) -replace '^v', ''
$major, $minor = $version.Split('.')[0..1] | ForEach-Object { [int] $_ }
if ($major -lt $nodeMinMajor -or ($major -eq $nodeMinMajor -and $minor -lt $nodeMinMinor)) {
  throw "upm install: Node.js $nodeMinMajor.$nodeMinMinor+ is required, found ${version}: https://nodejs.org/en/download"
}

# `--min-release-age 0` lets npm install a release published moments ago.
& npm i -g upm --min-release-age 0
if ($LASTEXITCODE -ne 0) { throw "upm install: npm exited with $LASTEXITCODE" }
