#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p dist/server dist/.openai
# Sites expects a single Worker entrypoint in the deployment archive.
sed 's/^export async function resolveMediaRequest/async function resolveMediaRequest/' worker/media.js > dist/server/index.js
sed '/^import { resolveMediaRequest } from ".\/media.js";$/d' worker/index.js >> dist/server/index.js
cp .openai/hosting.json dist/.openai/
cp -R drizzle dist/
