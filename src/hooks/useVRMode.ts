import { useEffect, useState } from 'react'
import { useWebXRSupport } from './useWebXRSupport'

// What we should do with WebXR for this device:
//   'off'        — WebXR not supported, or supported but on a device we don't
//                  want to auto-route (regular phone). No VR UI shown.
//   'available'  — WebXR is supported but the device isn't a known 6DOF
//                  headset browser. Show a small opt-in "Enter VR" button;
//                  do NOT replace the flat UI.
//   'auto'       — We're confident this is a real headset browser
//                  (Quest / PICO / dev-forced via ?vr=force). Show the
//                  fullscreen tap-to-enter overlay.
export type VRMode = 'off' | 'available' | 'auto'

// UA-sniff for known 6DOF headset browsers. The W3C WebXR spec doesn't
// expose "is this a real headset?" so this is the practical signal. Covers
// >99% of real headsets people would actually use in 2026.
function isKnownHeadsetBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  // Meta Quest, PICO Neo/4, Wolvic (Quest/PICO), HTC Vive Browser
  return /OculusBrowser|PicoBrowser|Wolvic|VivePort|HTC_VR/i.test(ua)
}

// Mobile / tablet detection. Phones with WebXR polyfills or legacy native
// WebXR still default to flat — we never want to surprise a normal phone
// user with a VR overlay. They can opt in via ?vr=force if they really mean it.
function isMobileLike(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /Mobile|Tablet|Android|iPhone|iPad|iPod/i.test(ua)
}

function getVRUrlOverride(): 'force' | 'off' | null {
  if (typeof window === 'undefined') return null
  const v = new URLSearchParams(window.location.search).get('vr')
  if (v === 'force') return 'force'
  if (v === 'off') return 'off'
  return null
}

export function useVRMode(): { mode: VRMode; checked: boolean } {
  const { supported, checked } = useWebXRSupport()
  // Read these once on mount — they don't change without a reload.
  const [urlOverride] = useState<'force' | 'off' | null>(() => getVRUrlOverride())
  const [headset] = useState<boolean>(() => isKnownHeadsetBrowser())
  const [mobile] = useState<boolean>(() => isMobileLike())
  const [mode, setMode] = useState<VRMode>('off')

  useEffect(() => {
    if (!checked) return

    // ?vr=off forces flat everywhere, no exceptions.
    if (urlOverride === 'off')   { setMode('off'); return }

    // Known headset browser (Quest / PICO / Wolvic) → auto-enter VR.
    if (headset)                 { setMode('auto'); return }

    // Desktop: no VR offered. Period. Even ?vr=force is ignored on desktop.
    // VR is for real headset browsers and (in debug) for phones.
    if (!mobile)                 { setMode('off'); return }

    // Phone debug: opt-in via ?vr=force only. Easy to turn off — just hand out
    // URLs without the query string. WebXR still has to actually be supported
    // (navigator.xr available + immersive-vr session-supported); we don't
    // pretend a session can start when the browser can't honor it.
    if (urlOverride === 'force' && supported) { setMode('auto'); return }

    setMode('off')
  }, [checked, supported, urlOverride, headset, mobile])

  return { mode, checked }
}
