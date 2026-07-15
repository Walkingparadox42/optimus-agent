---
name: optimus-gpu-mode
description: |
  Switch or inspect the shared Urithiru RTX 3060 used by Voicebox, ComfyUI,
  and Bonsai. Use when the user asks to start, stop, call up, fire up, switch
  to, or check any of those GPU workloads, asks what is using GPU/VRAM, or
  begins a task that requires Voicebox, image generation, or local Bonsai.
---

# Optimus GPU modes

The RTX 3060 is an exclusive shared resource. Use the local CT115 command only:

```bash
optimus-gpu status
optimus-gpu voice
optimus-gpu image
optimus-gpu llm
optimus-gpu idle
```

Mode mapping:

- `voice`: Voicebox / Chatterbox Turbo on CT120.
- `image`: ComfyUI on CT120.
- `llm`: Bonsai 27B on CT102.
- `idle`: stop and disable every GPU-heavy service.

## Behavior

1. For status questions, run `optimus-gpu status` and report the returned mode,
   active services, and VRAM use.
2. A direct request such as "fire up Voicebox", "switch to image mode", or
   "free the GPU" is authorization to run the matching command immediately.
3. When the user starts an image, Voicebox, or Bonsai task and the required
   mode is not active, state briefly that the GPU is switching, then run the
   matching command.
4. A successful switch is not proven until the JSON response has `"ok": true`
   and the requested service is active. Voice mode additionally performs a real
   audio generation; it does not rely on an open port alone.
5. If a command returns `"ok": false`, report the error and current mode. Do not
   claim the requested workload is ready.
6. Never bypass this controller with raw SSH, `pct`, `systemctl`, process kills,
   or direct service manipulation.

Switching modes deliberately stops the previous workload and changes boot-time
enablement so a reboot cannot recreate the VRAM collision.
