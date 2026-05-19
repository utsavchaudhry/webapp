import { Wifi, WifiOff, Video, ShieldAlert } from 'lucide-react'
import { useWebRTC } from '../contexts/WebRTCContext'
import './ConnectionPanel.css'

export const ConnectionPanel = () => {
  const { connectionState, connect, disconnect, isOperatorMediaActive, rejectionReason } = useWebRTC()

  const isConnected = connectionState === 'connected'
  const isConnecting = connectionState === 'connecting'
  const isRejected = connectionState === 'rejected'

  return (
    <div className="connection-panel">
      {isRejected && rejectionReason && (
        <div className="rejection-banner">
          <ShieldAlert size={20} />
          <div className="rejection-content">
            <span className="rejection-title">Connection Refused</span>
            <span className="rejection-message">{rejectionReason}</span>
          </div>
          <button
            onClick={connect}
            className="connection-button retry-button"
          >
            Try Again
          </button>
        </div>
      )}
      <div className="connection-input-group">
        <button
          onClick={isConnected ? disconnect : connect}
          disabled={isConnecting}
          className={`connection-button ${isConnected ? 'connected' : ''}`}
        >
          {isConnected ? (
            <>
              <Wifi size={18} />
              <span>Disconnect</span>
            </>
          ) : (
            <>
              <WifiOff size={18} />
              <span>{isConnecting ? 'Connecting...' : 'Connect'}</span>
            </>
          )}
        </button>

        <span className={`media-indicator ${isOperatorMediaActive ? 'active' : ''}`}>
          <Video size={16} />
          <span>{isOperatorMediaActive ? 'Streaming' : 'Media ready'}</span>
        </span>
      </div>
    </div>
  )
}
