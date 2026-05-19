import { useWebRTC } from '../contexts/WebRTCContext'
import './ConnectingOverlay.css'

export const ConnectingOverlay = () => {
  const { connectionState, connect, rejectionReason, isManualDisconnect } = useWebRTC()

  if (connectionState === 'connected') return null

  const isInUse = rejectionReason?.toLowerCase().includes('another user') ||
                  rejectionReason?.toLowerCase().includes('being operated')
  const isTimeout = rejectionReason?.toLowerCase().includes('time limit')
  const isStale = rejectionReason?.toLowerCase().includes('heartbeat') ||
                  rejectionReason?.toLowerCase().includes('stale')

  return (
    <div className="connecting-overlay">
      {connectionState === 'connecting' && (
        <div className="connecting-card">
          <div className="spinner" />
          <span className="connecting-label">Connecting to robot...</span>
        </div>
      )}

      {connectionState === 'disconnected' && !isManualDisconnect && (
        <div className="connecting-card">
          <span className="connecting-emoji">🤖</span>
          <span className="connecting-label">Robot ready</span>
          <p className="connecting-detail">
            Press Connect to start the session. We don't auto-connect anymore —
            it was causing duplicate sessions on devices that reload or
            background-restart the page.
          </p>
          <button className="reconnect-button" onClick={connect}>
            🔌 Connect
          </button>
        </div>
      )}

      {connectionState === 'disconnected' && isManualDisconnect && (
        <div className="connecting-card">
          <div className="spinner" />
          <span className="connecting-label">Redirecting...</span>
        </div>
      )}

      {connectionState === 'failed' && (
        <div className="connecting-card">
          <span className="connecting-emoji">🤖💤</span>
          <span className="connecting-label">Robot Offline</span>
          <p className="connecting-detail">The robot isn't reachable right now. Please come back later.</p>
          <button className="reconnect-button" onClick={connect}>
            🔄 Retry
          </button>
        </div>
      )}

      {connectionState === 'rejected' && (
        <div className="connecting-card">
          <span className="connecting-emoji">
            {isInUse ? '🤖🔒' : isTimeout ? '⏰' : isStale ? '📡' : '🤖'}
          </span>
          <span className="connecting-label">
            {isInUse ? 'Robot Busy' : isTimeout ? 'Session Expired' : isStale ? 'Connection Lost' : 'Disconnected'}
          </span>
          <p className="connecting-detail">
            {isInUse
              ? 'Someone else is currently operating the robot. Please come back later.'
              : isTimeout
              ? 'Your session time limit has been reached.'
              : isStale
              ? 'The connection was lost. Please try reconnecting.'
              : rejectionReason || 'The robot ended the session.'}
          </p>
          <button className="reconnect-button" onClick={connect}>
            🔄 {isInUse ? 'Try Again' : 'Reconnect'}
          </button>
        </div>
      )}
    </div>
  )
}
