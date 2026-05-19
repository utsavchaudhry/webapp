import { useWebRTC } from '../contexts/WebRTCContext'
import './StatusBar.css'

export const StatusBar = () => {
  const { statusMessage, connectionState } = useWebRTC()

  const getStatusColor = () => {
    switch (connectionState) {
      case 'connected':
        return '#10b981'
      case 'connecting':
        return '#f59e0b'
      case 'failed':
        return '#ef4444'
      case 'rejected':
        return '#f59e0b'
      default:
        return '#6b7280'
    }
  }

  return (
    <div className="status-bar">
      <div className="status-indicator" style={{ background: getStatusColor() }} />
      <span className="status-text">{statusMessage}</span>
    </div>
  )
}
