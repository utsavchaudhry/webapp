import { useState, useCallback, lazy, Suspense } from 'react'
import { Maximize } from 'lucide-react'
import { WebRTCProvider } from './contexts/WebRTCContext'
import { useWebRTC } from './contexts/WebRTCContext'
import { VideoDisplay } from './components/VideoDisplay'
import { ControlPanel } from './components/ControlPanel'
import { StatusBar } from './components/StatusBar'
import { ConnectingOverlay } from './components/ConnectingOverlay'
import { VREntryOverlay } from './components/vr/VREntryOverlay'
import { useVRMode } from './hooks/useVRMode'
import { useFullscreen } from './hooks/useFullscreen'
import './App.css'

// Lazy-load the VR scene so flat-mode visitors (desktop, phone, headset
// in flat browser tab) don't pay the three.js + @react-three/* download.
// The bundle (~600 KB gzip) only ships when the user actually enters VR.
const VRSession = lazy(() =>
  import('./components/vr/VRSession').then((m) => ({ default: m.VRSession })),
)

function AppInner({ isConnected, isFullscreen, enterFullscreen }: {
  isConnected: boolean
  isFullscreen: boolean
  enterFullscreen: () => void
}) {
  const { disconnect } = useWebRTC()

  const handleDisconnect = useCallback(() => {
    disconnect()
    window.location.href = 'https://www.shopmetal.com/'
  }, [disconnect])

  return (
    <div className="app">
      <div className="main-content">
        <VideoDisplay />
        <ConnectingOverlay />
        {isConnected && <ControlPanel />}
      </div>
      <div className="top-right-buttons">
        {isConnected && (
          <button className="disconnect-button" onClick={handleDisconnect}>
            🔴 Disconnect
          </button>
        )}
        {!isFullscreen && (
          <button className="fullscreen-button" onClick={enterFullscreen}>
            <Maximize size={16} />
            <span>Fullscreen</span>
          </button>
        )}
      </div>
      {!isFullscreen && <StatusBar />}
    </div>
  )
}

function App() {
  const [isConnected, setIsConnected] = useState(false)
  const { isFullscreen, enterFullscreen } = useFullscreen()

  // VR mode access policy (see useVRMode.ts):
  //   - Known headset browsers (Quest / PICO / Wolvic): auto-enter VR overlay.
  //   - Desktop: flat only, no VR UI, no ?vr=force override accepted.
  //   - Phones: flat by default; ?vr=force in URL enables the VR overlay
  //     (for debugging). To "turn off" phone VR, drop the query string.
  const { mode: vrMode } = useVRMode()
  const [vrActive, setVrActive] = useState(false)
  const enterVR = useCallback(() => setVrActive(true), [])
  const exitVR = useCallback(() => setVrActive(false), [])

  return (
    <WebRTCProvider onConnectionChange={setIsConnected}>
      <AppInner
        isConnected={isConnected}
        isFullscreen={isFullscreen}
        enterFullscreen={enterFullscreen}
      />
      {vrMode === 'auto' && !vrActive && (
        <VREntryOverlay onEnter={enterVR} />
      )}
      {vrActive && (
        <Suspense fallback={null}>
          <VRSession onSessionEnd={exitVR} />
        </Suspense>
      )}
    </WebRTCProvider>
  )
}

export default App
