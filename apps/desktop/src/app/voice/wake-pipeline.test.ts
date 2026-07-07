import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import * as ort from 'onnxruntime-web'
import { beforeAll, describe, expect, it } from 'vitest'

import { WAKE_CHUNK_SAMPLES, type WakeModels, WakePipeline, type WakeTensor } from './wake-pipeline'

/**
 * Model-in-the-loop test: runs the REAL openWakeWord ONNX models (the same
 * files the renderer serves from public/wake/) against a Piper-synthesized
 * "Hey Jarvis" fixture. Mirrors the Python validation on CT115 (2026-07-07:
 * positive 0.998, negatives 0.000). Uses onnxruntime-web's WASM backend in
 * Node — the same runtime the renderer uses.
 */

const MODEL_DIR = join(__dirname, '..', '..', '..', 'public', 'wake')
const FIXTURE = join(__dirname, '__fixtures__', 'hey-jarvis-16k.wav')

function loadWavPcm(path: string): Int16Array {
  const raw = readFileSync(path)
  // Minimal RIFF walk: find the 'data' chunk (fixture is canonical PCM16 mono 16k).
  let offset = 12

  while (offset + 8 <= raw.length) {
    const id = raw.toString('ascii', offset, offset + 4)
    const size = raw.readUInt32LE(offset + 4)

    if (id === 'data') {
      return new Int16Array(raw.buffer, raw.byteOffset + offset + 8, size / 2)
    }

    offset += 8 + size + (size % 2)
  }

  throw new Error('no data chunk in fixture wav')
}

let models: WakeModels

async function maxScore(pcm: Int16Array): Promise<number> {
  const pipeline = new WakePipeline(models)
  let best = 0

  for (let offset = 0; offset + WAKE_CHUNK_SAMPLES <= pcm.length; offset += WAKE_CHUNK_SAMPLES) {
    const score = await pipeline.process(pcm.subarray(offset, offset + WAKE_CHUNK_SAMPLES))

    if (score !== null && score > best) {
      best = score
    }
  }

  return best
}

beforeAll(async () => {
  ort.env.wasm.numThreads = 1

  const load = (name: string) =>
    ort.InferenceSession.create(new Uint8Array(readFileSync(join(MODEL_DIR, name))))

  const [mel, embedding, wake] = await Promise.all([
    load('melspectrogram.onnx'),
    load('embedding_model.onnx'),
    load('hey_jarvis_v0.1.onnx')
  ])

  models = {
    embedding,
    makeTensor: (data, dims) => new ort.Tensor('float32', data, dims) as unknown as WakeTensor,
    melspectrogram: mel,
    wake
  }
}, 60_000)

describe('wake pipeline with real models', () => {
  it('activates on the Piper "Hey Jarvis" fixture', async () => {
    const score = await maxScore(loadWavPcm(FIXTURE))

    expect(score).toBeGreaterThan(0.5)
  }, 60_000)

  it('stays silent on noise', async () => {
    // Deterministic pseudo-noise at ambient-ish level, 6 seconds.
    const noise = new Int16Array(16_000 * 6)
    let seed = 7

    for (let index = 0; index < noise.length; index += 1) {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7f_ff_ff_ff
      noise[index] = ((seed / 0x7f_ff_ff_ff) * 2 - 1) * 800
    }

    const score = await maxScore(noise)

    expect(score).toBeLessThan(0.3)
  }, 60_000)
})
