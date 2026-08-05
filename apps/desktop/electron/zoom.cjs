/**
 * Pure helpers for window zoom. The main process owns webContents zoom so the
 * menu, keyboard shortcuts, and Appearance setting share one clamped scale.
 */

const ZOOM_STORAGE_KEY = 'hermes:desktop:zoomLevel'

const ZOOM_FACTOR_BASE = 1.2
const MIN_ZOOM_LEVEL = -9
const MAX_ZOOM_LEVEL = 9

function clampZoomLevel(value) {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, MIN_ZOOM_LEVEL), MAX_ZOOM_LEVEL)
}

function zoomLevelToPercent(level) {
  return Math.round(Math.pow(ZOOM_FACTOR_BASE, clampZoomLevel(level)) * 100)
}

function percentToZoomLevel(percent) {
  if (!Number.isFinite(percent) || percent <= 0) return 0
  return clampZoomLevel(Math.log(percent / 100) / Math.log(ZOOM_FACTOR_BASE))
}

module.exports = {
  ZOOM_STORAGE_KEY,
  clampZoomLevel,
  percentToZoomLevel,
  zoomLevelToPercent
}
