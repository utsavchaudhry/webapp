import { useState, useCallback } from 'react'
import { Camera, Mic, ShieldAlert } from 'lucide-react'
import './MediaGate.css'

interface MediaGateProps {
  children: React.ReactNode
}

export const MediaGate = ({ children }: MediaGateProps) => {
  const [granted, setGranted] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requestPermissions = useCallback(async () => {
    setRequesting(true)
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      })
      stream.getTracks().forEach(t => t.stop())
      setGranted(true)
    } catch (err) {
      if (err instanceof DOMException) {
        switch (err.name) {
          case 'NotAllowedError':
            setError('Camera and microphone access was denied. Please allow access in your browser settings and try again.')
            break
          case 'NotFoundError':
            setError('No camera or microphone found. Please connect a camera and microphone, then try again.')
            break
          case 'NotReadableError':
            setError('Camera or microphone is already in use by another application.')
            break
          default:
            setError(`Media access failed: ${err.message}`)
        }
      } else {
        setError(`Unexpected error: ${err}`)
      }
    } finally {
      setRequesting(false)
    }
  }, [])

  if (granted) {
    return <>{children}</>
  }

  return (
    <div className="media-gate">
      <div className="media-gate-card">
        <div className="media-gate-icon-row">
          <Camera size={32} />
          <Mic size={32} />
        </div>

        <h1 className="media-gate-title">Camera & Microphone Required</h1>
        <p className="media-gate-description">
          This operator dashboard requires access to your camera and microphone
          to stream video and audio to the robot.
        </p>

        <button
          className="media-gate-button"
          onClick={requestPermissions}
          disabled={requesting}
        >
          {requesting ? (
            <>
              <span className="media-gate-spinner" />
              Requesting access…
            </>
          ) : 'Grant Camera & Mic Access'}
        </button>

        {error && (
          <div className="media-gate-error">
            <ShieldAlert size={18} />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  )
}
