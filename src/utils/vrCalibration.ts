// Persistent VR calibration store + helpers.
//
// The robot's IK solver consumes controller positions relative to the head,
// in metres, scaled so the user's reach distance maps onto the robot's
// physical workspace (~0.5 m from shoulder). The scale = robot_reach / user_reach
// is captured once by having the user enter a T-pose and pressing LEFT-Y.
//
// Calibration is per-device (localStorage) because reach varies by user/
// headset placement; clearing localStorage forces a re-calibration on the
// next session.

export const CALIB_STORAGE_KEY = 'vr_calibration_scale'

// Robot's per-arm reach (metres), taken from teleop_config.yaml workspace
// bounds (max_x = 0.5). User's calibrated arm-span maps onto this.
export const ROBOT_ARM_REACH_M = 0.5

// Sanity bounds for a measured arm-span (head→controller distance averaged
// across both hands). Anything outside means the user was not in T-pose or
// only one controller was tracking — refuse to save.
export const MIN_VALID_ARM_SPAN_M = 0.4
export const MAX_VALID_ARM_SPAN_M = 1.2

export function loadCalibrationScale(): number | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(CALIB_STORAGE_KEY)
  if (!raw) return null
  const n = parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function saveCalibrationScale(scale: number) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(CALIB_STORAGE_KEY, String(scale))
  // Fire a storage event for other tabs / hook subscribers. The native
  // 'storage' event only fires across documents, so dispatch a CustomEvent
  // for same-document listeners (our useCalibration hook).
  window.dispatchEvent(new CustomEvent('vr-calibration-changed'))
}

export function clearCalibrationScale() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(CALIB_STORAGE_KEY)
  window.dispatchEvent(new CustomEvent('vr-calibration-changed'))
}

// Returns the new scale on success, or a string error on validation failure.
export function computeAndSaveCalibration(avgArmSpanM: number): number | string {
  if (avgArmSpanM < MIN_VALID_ARM_SPAN_M) {
    return `Arms too close (${avgArmSpanM.toFixed(2)} m). Extend arms straight out to the sides.`
  }
  if (avgArmSpanM > MAX_VALID_ARM_SPAN_M) {
    return `Arms too far (${avgArmSpanM.toFixed(2)} m). Make sure the controllers are tracked.`
  }
  const scale = ROBOT_ARM_REACH_M / avgArmSpanM
  saveCalibrationScale(scale)
  return scale
}
