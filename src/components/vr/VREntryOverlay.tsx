import { useWebRTC } from '../../contexts/WebRTCContext'
import { useCalibration } from '../../hooks/useCalibration'

interface VREntryOverlayProps {
  onEnter: () => void
}

// Fullscreen tap-to-start overlay shown ONLY on WebXR-capable devices.
// The "one tap" exists because WebXR's requestSession() requires a transient
// user activation — there's no spec-legal way to skip it.
//
// Two flows depending on calibration state (persisted in localStorage):
//   1. No calibration → tap enters VR for the one-time T-pose calibration.
//      Crucially we do NOT call connect() yet — the robot must not start
//      receiving teleop until the user→robot scale is known.
//   2. Calibration present → tap enters VR AND kicks off connect().
// Multi-tap is harmless: re-entering while connectionState=='connecting' is
// guarded by the connect-if-needed check.
export function VREntryOverlay({ onEnter }: VREntryOverlayProps) {
  const { connectionState, connect } = useWebRTC()
  const { hasCalibration } = useCalibration()

  const handleEnter = () => {
    if (hasCalibration &&
        (connectionState === 'disconnected' ||
         connectionState === 'failed' ||
         connectionState === 'rejected')) {
      connect()
    }
    onEnter()
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleEnter}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleEnter() }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'radial-gradient(ellipse at center, #1e1b4b 0%, #000 80%)',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        cursor: 'pointer',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        textAlign: 'center',
        padding: 24,
      }}
    >
      <div style={{ fontSize: 96, lineHeight: 1 }}>🥽</div>
      <div style={{ fontSize: 28, fontWeight: 700 }}>
        {hasCalibration ? 'Tap anywhere to enter VR' : 'Tap to set up VR'}
      </div>
      <div style={{ fontSize: 14, opacity: 0.7, maxWidth: 340 }}>
        {hasCalibration
          ? 'Your headset is detected. One tap is required by the browser before immersive mode can start.'
          : 'First-time setup: you\'ll calibrate your reach in a T-pose. The robot won\'t connect until calibration is complete.'}
      </div>
    </div>
  )
}
