import { useEffect, useState } from 'react'
import { CALIB_STORAGE_KEY, loadCalibrationScale } from '../utils/vrCalibration'

// Reactive view over the persisted VR calibration. Re-renders whenever the
// saved scale appears, changes, or is cleared. Used by App.tsx to gate VR
// entry / WebRTC connect on calibration existing.
export function useCalibration() {
  const [scale, setScale] = useState<number | null>(() => loadCalibrationScale())

  useEffect(() => {
    const refresh = () => setScale(loadCalibrationScale())

    // Cross-document changes (rare in single-page app) and our own
    // same-document dispatched event from saveCalibrationScale.
    window.addEventListener('storage', (e) => {
      if (e.key === CALIB_STORAGE_KEY) refresh()
    })
    window.addEventListener('vr-calibration-changed', refresh)
    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener('vr-calibration-changed', refresh)
    }
  }, [])

  return {
    scale,
    hasCalibration: scale !== null,
  }
}
