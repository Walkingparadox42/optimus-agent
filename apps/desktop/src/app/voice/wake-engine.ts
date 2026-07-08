/**
 * [Optimus Cockpit] Wake engine seam — Phase 4 P1D-2.
 *
 * openWakeWord (D3 decision, Steve 2026-07-07: fully local, no phone-home
 * in the wake path). Runs the three ONNX models in-renderer via
 * onnxruntime-web's WASM backend; model files ship as static assets under
 * public/wake/. Uses a first-pass local "Hey Optimus" openWakeWord model
 * trained on CT115 from synthetic samples; tune/retrain as real samples
 * come in.
 *
 * Seam shape mirrors TTSEngine/STTEngine on the service: policy (D3) is
 * stable, the engine behind load()/feed() is swappable.
 */

import * as ort from 'onnxruntime-web'

// Vite bundles BOTH runtime artifacts from node_modules as assets — nothing
// binary in the repo, no CDN, no network at runtime. The .mjs loader must be
// pinned alongside the .wasm: ort's default resolves it relative to its own
// (vite-optimized) chunk URL, where the file does not exist in dev — that
// unresolved dynamic import is what surfaced as "wake engine failed to
// load". Relative paths (not package subpaths) because onnxruntime-web's
// exports map blocks ./dist/*; the hoisted root node_modules location is
// guaranteed by this repo's own scripts/assert-root-install.cjs.
import ortWasmMjsUrl from '../../../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url'
import ortWasmUrl from '../../../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url'

// Single-threaded WASM, decided at MODULE scope before any ort use: wake
// inference needs ~1ms per 80ms chunk, and numThreads=1 removes the
// SharedArrayBuffer / cross-origin-isolation requirement entirely (the
// Electron dev server sends no COOP/COEP headers, so SAB is unavailable —
// verified: sessions create fine without SAB when single-threaded).
ort.env.wasm.numThreads = 1
ort.env.wasm.proxy = false
ort.env.wasm.wasmPaths = { mjs: ortWasmMjsUrl, wasm: ortWasmUrl }

import { WAKE_THRESHOLD, type WakeModels, WakePipeline, type WakeTensor } from './wake-pipeline'

const MODEL_BASE = `${import.meta.env.BASE_URL}wake/`
const WAKE_MODEL_URL = `${MODEL_BASE}hey_optimus_v0.1.onnx`
const MEL_MODEL_URL = `${MODEL_BASE}melspectrogram.onnx`
const EMBEDDING_MODEL_URL = `${MODEL_BASE}embedding_model.onnx`

export class WakeEngine {
  private pipeline: null | WakePipeline = null
  /** Called once per detection (edge-triggered with a refractory period). */
  onWake: (() => void) | null = null
  private refractoryUntil = 0

  get ready(): boolean {
    return this.pipeline !== null
  }

  async load(): Promise<void> {
    if (this.pipeline) {
      return
    }

    const [mel, embedding, wake] = await Promise.all([
      ort.InferenceSession.create(MEL_MODEL_URL),
      ort.InferenceSession.create(EMBEDDING_MODEL_URL),
      ort.InferenceSession.create(WAKE_MODEL_URL)
    ])

    const models: WakeModels = {
      embedding,
      makeTensor: (data, dims) => new ort.Tensor('float32', data, dims) as unknown as WakeTensor,
      melspectrogram: mel,
      wake
    }

    this.pipeline = new WakePipeline(models)
  }

  /** Feed mic PCM16 while in idle_wake_only. Detection fires onWake. */
  async feed(pcm: Int16Array): Promise<void> {
    if (!this.pipeline) {
      return
    }

    const score = await this.pipeline.process(pcm)

    if (score !== null && score > WAKE_THRESHOLD && Date.now() >= this.refractoryUntil) {
      // 2s refractory so one utterance of the phrase fires exactly once.
      this.refractoryUntil = Date.now() + 2_000
      this.pipeline.reset()
      this.onWake?.()
    }
  }

  reset(): void {
    this.pipeline?.reset()
  }
}
