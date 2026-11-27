#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p dist/server dist/.openai
cp worker/index.js dist/server/index.js
cp .openai/hosting.json dist/.openai/
cp -R drizzle dist/
