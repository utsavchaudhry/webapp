import { Canvas, useFrame } from '@react-three/fiber'
import { XR, createXRStore, useXRStore } from '@react-three/xr'
import { useEffect, useMemo, useRef } from 'react'
import { useWebRTC } from '../../contexts/WebRTCContext'
import { useCalibration } from '../../hooks/useCalibration'
import { CalibrationScene } from './CalibrationScene'
import { VRScene } from './VRScene'

interface VRSessionProps {
  onSessionEnd?: () => void
}

// Lives inside <XR>. Uses useFrame to attempt enterVR — by the time r3f's
// frame loop kicks off, <XR> has already bound the WebGLRenderer to the
// store. Doing this from a useEffect (which runs depth-first child→parent)
// fires BEFORE <XR>'s own useEffect and crashes with
// "not connected to three.js". useFrame avoids that.
function AutoEnter({ onFail }: { onFail?: () => void }) {
  const store = useXRStore()
  const triedRef = useRef(false)

  useFrame(() => {
    if (triedRef.current) return
    triedRef.current = true
    store.enterVR().catch((err: unknown) => {
      console.warn('[VR] enterVR failed:', err)
      onFail?.()
    })
  })

  return null
}

export function VRSession({ onSessionEnd }: VRSessionProps) {
  const { videoRef } = useWebRTC()
  const { hasCalibration } = useCalibration()
  const store = useMemo(() => createXRStore(), [])

  // Robot is launched with stream_mode=vr (always SBS) — client always
  // splits in the frontend. No need to toggle stream_mode per session.
  // We only watch for session end to notify the parent.
  useEffect(() => {
    const unsub = store.subscribe((state, prev) => {
      if (!state.session && prev.session) {
        onSessionEnd?.()
      }
    })
    return () => {
      unsub()
      // If we're unmounting with an active session still, end it cleanly.
      const session = store.getState().session
      if (session) session.end().catch(() => {})
    }
  }, [store, onSessionEnd])

  // After successful calibration, end the WebXR session so the user lands
  // back at the entry overlay (now with calibration present). The next tap
  // will call connect() and re-enter VR in teleop mode.
  const handleCalibrated = () => {
    const session = store.getState().session
    if (session) session.end().catch(() => {})
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: '#000',
    }}>
      <Canvas camera={{ position: [0, 1.6, 0], fov: 70 }}>
        <XR store={store}>
          <AutoEnter onFail={onSessionEnd} />
          {hasCalibration ? (
            <VRScene video={videoRef.current} />
          ) : (
            <CalibrationScene onComplete={handleCalibrated} />
          )}
        </XR>
      </Canvas>
    </div>
  )
}
