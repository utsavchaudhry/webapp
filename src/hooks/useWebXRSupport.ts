import { useEffect, useState } from 'react'

// Quest browser, PICO browser, Chrome+SteamVR, Edge+WMR all expose navigator.xr.
// Firefox dropped WebXR support; iOS Safari has a partial implementation on
// Vision Pro (immersive-vr unsupported there — it advertises 'immersive-ar').
export function useWebXRSupport(): { supported: boolean; checked: boolean } {
  const [supported, setSupported] = useState(false)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr
    if (!xr || typeof xr.isSessionSupported !== 'function') {
      setChecked(true)
      return
    }
    xr.isSessionSupported('immersive-vr')
      .then((ok) => setSupported(!!ok))
      .catch(() => setSupported(false))
      .finally(() => setChecked(true))
  }, [])

  return { supported, checked }
}
