#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
pnpm --filter @enso/phone build
rm -rf packages/relay-go/frontend
cp -R packages/phone/dist packages/relay-go/frontend
# 桌面 renderer 产物（pnpm build 的 out/renderer）一并内置：手机完整版直接从中继取，不必经隧道从电脑拉
if [[ -f out/renderer/web-preload.js ]]; then
  cp -R out/renderer packages/relay-go/frontend/desk-bundle
  find packages/relay-go/frontend/desk-bundle -name '*.map' -delete
fi
