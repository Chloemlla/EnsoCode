# pi-observational-memory 3.1.3

Vendored from `npm:pi-observational-memory@3.1.3` (MIT).

Do not edit `vendor/` to add Enso behavior. Wrap in `extension.ts`:
- map Enso `smartCompactModel` onto `runtime.config.model`
- empty/error compact → Enso verified fallback (never `undefined` on overflow)

Backported from 3.1.4: `agents/worker-stream.ts` keeps the `ModelRegistry` receiver.
