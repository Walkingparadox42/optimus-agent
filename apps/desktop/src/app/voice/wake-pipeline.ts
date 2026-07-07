/**
 * [Optimus Cockpit] openWakeWord streaming pipeline — Phase 4 P1D-2.
 *
 * Pure logic, no renderer/vite imports: takes three pre-created
 * onnxruntime sessions (melspectrogram -> speech embedding -> wake head)
 * and consumes 16 kHz PCM16 in 80 ms steps. Validated 2026-07-07 against
 * the reference models on CT115: Piper "Hey Jarvis" scores 0.998+, other
 * speech and noise score 0.000, ~1 ms per chunk on CPU.
 *
 * Approach: instead of porting openWakeWord's incremental feature
 * buffering, each 80 ms step recomputes the mel spectrogram over the last
 * ~0.86 s of raw audio and takes the newest 76 mel frames -> one embedding
 * -> rolling window of 16 embeddings -> score. Costs a few redundant
 * milliseconds per step; removes an entire class of buffer-alignment bugs.
 *
 * Model I/O (inspected from the shipped ONNX files, not assumed):
 *   melspectrogram.onnx  IN  input   [batch, samples] f32 (int16-range!)
 *                        OUT         [t, 1, frames, 32]; use x/10 + 2
 *   embedding_model.onnx IN  input_1 [batch, 76, 32, 1]
 *                        OUT         [batch, 1, 1, 96]
 *   hey_jarvis_v0.1.onnx IN  x.1     [1, 16, 96]  OUT [1, 1] score
 */

export const WAKE_CHUNK_SAMPLES = 1_280 // 80 ms @ 16 kHz
export const WAKE_THRESHOLD = 0.5

const MEL_BANDS = 32
const MEL_WINDOW_FRAMES = 76
const EMBEDDING_DIM = 96
const SCORE_WINDOW = 16
// Raw samples needed for 76 mel frames (hop 160, window 400) plus one chunk.
const RAW_KEEP = (MEL_WINDOW_FRAMES - 1) * 160 + 400 + WAKE_CHUNK_SAMPLES

/** The slice of onnxruntime-web this pipeline needs (keeps tests free of
 *  the real package's environment plumbing). `data` is `unknown` so ort's
 *  wide Tensor.data union stays structurally assignable; the pipeline casts
 *  to Float32Array where it knows the model output type. */
export interface WakeSession {
  run(feeds: Record<string, WakeTensor>): Promise<Record<string, WakeTensor>>
}

export interface WakeTensor {
  data: unknown
  dims: readonly number[]
}

export interface WakeModels {
  embedding: WakeSession
  makeTensor(data: Float32Array, dims: number[]): WakeTensor
  melspectrogram: WakeSession
  wake: WakeSession
}

export class WakePipeline {
  private raw = new Float32Array(0)
  private pending = new Float32Array(0)
  private embeddings: Float32Array[] = []
  private busy = false

  constructor(private models: WakeModels) {}

  reset(): void {
    this.raw = new Float32Array(0)
    this.pending = new Float32Array(0)
    this.embeddings = []
  }

  /**
   * Feed PCM16 samples (any frame size; internally re-chunked to 80 ms).
   * Returns the max wake score produced by the completed steps, or null if
   * no full step ran. Steps are serialized — if a previous async step is
   * still running, new audio only accumulates.
   */
  async process(pcm: Int16Array): Promise<null | number> {
    const incoming = new Float32Array(pcm.length)

    for (let index = 0; index < pcm.length; index += 1) {
      incoming[index] = pcm[index] // int16 RANGE floats — the mel model wants raw amplitude
    }

    const merged = new Float32Array(this.pending.length + incoming.length)
    merged.set(this.pending)
    merged.set(incoming, this.pending.length)
    this.pending = merged

    if (this.busy) {
      return null
    }

    this.busy = true

    try {
      let best: null | number = null

      while (this.pending.length >= WAKE_CHUNK_SAMPLES) {
        const chunk = this.pending.subarray(0, WAKE_CHUNK_SAMPLES)
        this.pending = this.pending.slice(WAKE_CHUNK_SAMPLES)

        const score = await this.step(chunk)

        if (score !== null && (best === null || score > best)) {
          best = score
        }
      }

      return best
    } finally {
      this.busy = false
    }
  }

  private async step(chunk: Float32Array): Promise<null | number> {
    const merged = new Float32Array(this.raw.length + chunk.length)
    merged.set(this.raw)
    merged.set(chunk, this.raw.length)
    this.raw = merged.length > RAW_KEEP ? merged.slice(merged.length - RAW_KEEP) : merged

    if (this.raw.length < (MEL_WINDOW_FRAMES - 1) * 160 + 400) {
      return null
    }

    const { makeTensor } = this.models

    const melOut = await this.models.melspectrogram.run({
      input: makeTensor(this.raw.slice(), [1, this.raw.length])
    })

    const melTensor = Object.values(melOut)[0]
    const melData = melTensor.data as Float32Array
    const frames = melData.length / MEL_BANDS

    if (frames < MEL_WINDOW_FRAMES) {
      return null
    }

    // Newest 76 frames, with openWakeWord's x/10 + 2 transform.
    const windowData = new Float32Array(MEL_WINDOW_FRAMES * MEL_BANDS)
    const offset = (frames - MEL_WINDOW_FRAMES) * MEL_BANDS

    for (let index = 0; index < windowData.length; index += 1) {
      windowData[index] = melData[offset + index] / 10 + 2
    }

    const embOut = await this.models.embedding.run({
      input_1: makeTensor(windowData, [1, MEL_WINDOW_FRAMES, MEL_BANDS, 1])
    })

    const embedding = (Object.values(embOut)[0].data as Float32Array).slice(0, EMBEDDING_DIM)

    this.embeddings.push(new Float32Array(embedding))

    if (this.embeddings.length > SCORE_WINDOW) {
      this.embeddings.shift()
    }

    if (this.embeddings.length < SCORE_WINDOW) {
      return null
    }

    const features = new Float32Array(SCORE_WINDOW * EMBEDDING_DIM)

    for (let index = 0; index < SCORE_WINDOW; index += 1) {
      features.set(this.embeddings[index], index * EMBEDDING_DIM)
    }

    const wakeOut = await this.models.wake.run({
      'x.1': makeTensor(features, [1, SCORE_WINDOW, EMBEDDING_DIM])
    })

    return (Object.values(wakeOut)[0].data as Float32Array)[0]
  }
}
