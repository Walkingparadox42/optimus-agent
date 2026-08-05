const test = require('node:test')
const assert = require('node:assert/strict')

const { ZOOM_STORAGE_KEY, clampZoomLevel, percentToZoomLevel, zoomLevelToPercent } = require('./zoom.cjs')

test('storage key stays stable so persisted zoom survives upgrades', () => {
  assert.equal(ZOOM_STORAGE_KEY, 'hermes:desktop:zoomLevel')
})

test('clampZoomLevel rejects garbage and enforces bounds', () => {
  assert.equal(clampZoomLevel(NaN), 0)
  assert.equal(clampZoomLevel(Infinity), 0)
  assert.equal(clampZoomLevel(undefined), 0)
  assert.equal(clampZoomLevel('2'), 0)
  assert.equal(clampZoomLevel(0.3), 0.3)
  assert.equal(clampZoomLevel(-42), -9)
  assert.equal(clampZoomLevel(42), 9)
})

test('level zero is exactly 100 percent', () => {
  assert.equal(zoomLevelToPercent(0), 100)
  assert.equal(percentToZoomLevel(100), 0)
})

test('preset percentages roundtrip within rounding', () => {
  for (const percent of [90, 100, 110, 125, 150, 175]) {
    assert.equal(zoomLevelToPercent(percentToZoomLevel(percent)), percent)
  }
})

test('extreme percentages clamp to the level bounds', () => {
  assert.equal(percentToZoomLevel(1), -9)
  assert.equal(percentToZoomLevel(1_000_000), 9)
})
