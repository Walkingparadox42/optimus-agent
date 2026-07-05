# Avatar assets (Optimus Cockpit)

Drop headshot assets for the avatar/presence pane into THIS folder. No code
change needed — the pane probes for these files at runtime and falls back to
the BrandMark placeholder for any state whose file is missing. Consumed by
`src/app/avatar/index.tsx` (ASSET_BY_STATE).

## File contract

One file per presence state, named EXACTLY (case-sensitive, camelCase
`toolUse`):

```
idle.svg
listening.svg
thinking.svg
speaking.svg
toolUse.svg
waiting.svg
error.svg
```

- Current set: the Optimus Prime avatar series (animated SVG/SMIL, 192x192).
- Format: anything an <img> plays natively (SVG, animated WebP, GIF, APNG).
  Changing a state's format = replace the file AND change that state's
  extension in ASSET_BY_STATE (src/app/avatar/index.tsx) — one line.
- Size: square; rendered at 96x96 CSS px, so supply ~192x192 for HiDPI.
- Crop: displayed in a circle with `object-cover` — keep the face centered
  and safe from circular cropping; corners are cut.
- Partial sets are fine: ship `idle.webp` alone and add states later. A newly
  dropped file is picked up when the pane is closed/reopened (or on app
  relaunch) — no rebuild needed in dev; packaged builds bundle this folder at
  build time.
