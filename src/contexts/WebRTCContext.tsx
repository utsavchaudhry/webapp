import React, { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react'
import type { ConnectionState, TeleopCommand, WebRTCContextValue, WebRTCProviderProps, SignalingHandlers } from '../types/webrtc'
import { useSignaling } from '../hooks/useSignaling'
import { useRecvConnection } from '../hooks/useRecvConnection'
import { useSendConnection } from '../hooks/useSendConnection'
import type { RobotConfig } from '../hooks/useSendConnection'
import { useOperatorMedia } from '../hooks/useOperatorMedia'

export type { ConnectionState, TeleopCommand }

const WebRTCContext = createContext<WebRTCContextValue | null>(null)

// eslint-disable-next-line react-refresh/only-export-components -- hook + provider live together
export const useWebRTC = () => {
  const context = useContext(WebRTCContext)
  if (!context) {
    throw new Error('useWebRTC must be used within WebRTCProvider')
  }
  return context
}

export const WebRTCProvider: React.FC<WebRTCProviderProps> = ({ children, onConnectionChange }) => {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [statusMessage, setStatusMessage] = useState('Disconnected')
  const [rejectionReason, setRejectionReason] = useState<string | null>(null)

  // Guard against React StrictMode double-mount destroying connections
  const mountedRef = useRef(true)
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Media watchdog: retry entire connection if video frames aren't decoded within timeout
  const MEDIA_TIMEOUT_MS = 15_000
  const MAX_MEDIA_RETRIES = 20
  const mediaWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mediaVerifyRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mediaRetryCountRef = useRef(0)
  const watchdogCheckRef = useRef<() => void>(() => {})

  // --- Ref-based callback injection to break circular deps ---
  const handlersRef = useRef<SignalingHandlers>({
    onRecvOffer: () => {},
    onSendAnswer: () => {},
    onRecvIce: () => {},
    onSendIce: () => {},
    onSendRegistered: () => {},
    onSessionRejected: () => {},
  })

  // --- Hook: signaling ---
  const signaling = useSignaling({ handlersRef })

  // --- Hook: recv connection ---
  const onMediaVerified = useCallback(() => {
    if (mediaVerifyRef.current) {
      clearInterval(mediaVerifyRef.current)
      mediaVerifyRef.current = null
    }
    if (mediaWatchdogRef.current) {
      clearTimeout(mediaWatchdogRef.current)
      mediaWatchdogRef.current = null
    }
    mediaRetryCountRef.current = 0
    setConnectionState('connected')
    setStatusMessage('Connected')
    onConnectionChange?.(true)
  }, [onConnectionChange])

  const updateOverallConnectionState = useCallback(() => {
    const recvOk = recv.recvConnectedRef.current
    const sendOk = send.sendConnectedRef.current

    if (recvOk && sendOk) {
      // Both ICE connections up — reset watchdog so video gets the full timeout
      // (don't penalize video for time spent on ICE negotiation)
      if (mediaWatchdogRef.current) {
        clearTimeout(mediaWatchdogRef.current)
        mediaWatchdogRef.current = setTimeout(watchdogCheckRef.current, MEDIA_TIMEOUT_MS)
      }
      // Verify actual video frames are arriving
      if (!mediaVerifyRef.current) {
        mediaVerifyRef.current = setInterval(() => {
          const v = recv.videoRef.current
          if (v && v.videoWidth > 0 && v.readyState >= 2) {
            onMediaVerified()
          }
        }, 500)
      }
    } else if (recvOk) {
      setConnectionState('connecting')
      setStatusMessage('Receive connection established, waiting for send connection...')
    } else if (!recvOk && !sendOk) {
      setConnectionState('disconnected')
      setStatusMessage('Disconnected')
      onConnectionChange?.(false)
    }
    // sendOk && !recvOk: media watchdog timer handles retry — stay in 'connecting'
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable
  }, [onConnectionChange, onMediaVerified])

  const recv = useRecvConnection({
    sessionIdRef: signaling.sessionIdRef,
    onConnectionStateUpdate: updateOverallConnectionState,
  })

  // --- Hook: operator media (declared before send so we can reference it) ---
  // We need the refs from send, but send needs media.restartCaptureIfActive.
  // Break the cycle with refs for the media start/config callbacks.
  const autoStartMediaRef = useRef<() => void>(() => {})
  const mediaStartingRef = useRef(false)
  const onRobotConfigRef = useRef<(config: RobotConfig) => void>(() => {})

  // --- Hook: send connection ---
  const send = useSendConnection({
    sessionIdRef: signaling.sessionIdRef,
    onConnectionStateUpdate: updateOverallConnectionState,
    // Don't auto-start media on channel-ready — wait for the robot's
    // config message to tell us whether it wants operator media at all.
    onDataChannelsReady: () => {},
    onRobotConfig: (cfg) => onRobotConfigRef.current(cfg),
    onSessionEnded: (reason) => {
      // Robot evicted us (timeout or takeover) — show rejection and reconnect
      teardownAll()
      setConnectionState('rejected')
      setStatusMessage(reason)
      setRejectionReason(reason)
      onConnectionChange?.(false)
    },
  })

  // --- Hook: operator media ---
  const media = useOperatorMedia({
    videoChannelRef: send.videoChannelRef,
    audioChannelRef: send.audioChannelRef,
    sendPcRef: send.sendPcRef,
  })

  // Start operator media. Called from onRobotConfigRef when the robot
  // advertises enable_operator_media=true. With MediaGate removed, this is
  // the first time we touch getUserMedia and the browser will prompt for
  // camera/mic permission. The default robot config is `false` so this
  // path is dormant until you flip the toggle on the robot:
  //   ros2 param set /webrtc_node enable_operator_media true
  autoStartMediaRef.current = () => {
    if (media.isOperatorMediaActive) {
      media.restartCaptureIfActive()
    } else if (!mediaStartingRef.current) {
      mediaStartingRef.current = true
      media.startOperatorMedia({ video: true, audio: true })
        .catch(err => {
          console.error('[WebRTC] Auto-start operator media failed:', err)
        })
        .finally(() => {
          mediaStartingRef.current = false
        })
    }
  }

  // Mux based on robot config: start/stop operator media accordingly.
  // Default (no config received yet) → media stays off. This means we never
  // call getUserMedia and the browser never shows a permission prompt unless
  // the robot explicitly asks for it.
  onRobotConfigRef.current = (config) => {
    if (config.enable_operator_media === true) {
      autoStartMediaRef.current()
    } else if (config.enable_operator_media === false) {
      if (media.isOperatorMediaActive) media.stopOperatorMedia()
    }
  }

  // --- Wire signaling handlers (ref-based, always current) ---
  handlersRef.current = {
    onRecvOffer: (ws, sdp) => {
      recv.setupRecvConnection(ws, sdp).catch(err => {
        setConnectionState('failed')
        setStatusMessage('Failed to setup receive connection')
        console.error('[WebRTC] [RECV] Setup error:', err)
      })
    },
    onSendAnswer: (sdp) => {
      send.handleSendAnswer(sdp)
    },
    onRecvIce: (candidate) => {
      recv.addRecvIceCandidate(candidate)
    },
    onSendIce: (candidate) => {
      send.addSendIceCandidate(candidate)
    },
    onSendRegistered: (ws) => {
      send.createSendOfferAndSend(ws).catch(err => {
        setConnectionState('failed')
        setStatusMessage('Failed to create send offer')
        console.error('[WebRTC] [SEND] Create offer error:', err)
      })
    },
    onSessionRejected: (reason) => {
      // Tear down everything without triggering 'disconnected' state
      media.teardownMedia()
      send.teardownSend()
      recv.teardownRecv()
      signaling.disconnectSignaling()
      setConnectionState('rejected')
      setStatusMessage(reason)
      setRejectionReason(reason)
      onConnectionChange?.(false)
    },
  }

  // --- Teardown (no state changes — just cleans up resources) ---
  const teardownAll = useCallback(() => {
    if (mediaWatchdogRef.current) {
      clearTimeout(mediaWatchdogRef.current)
      mediaWatchdogRef.current = null
    }
    if (mediaVerifyRef.current) {
      clearInterval(mediaVerifyRef.current)
      mediaVerifyRef.current = null
    }
    media.teardownMedia()
    media.stopOperatorMedia()
    send.teardownSend()
    recv.teardownRecv()
    signaling.disconnectSignaling()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable refs
  }, [])

  // --- Disconnect (teardown + update state) ---
  const manualDisconnectRef = useRef(false)

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true
    mediaRetryCountRef.current = 0
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    teardownAll()
    setConnectionState('disconnected')
    setStatusMessage('Disconnected')
    setRejectionReason(null)
    onConnectionChange?.(false)
  }, [teardownAll, onConnectionChange])

  // --- Connect ---
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Set true while watchdog is tearing down + reconnecting, so onDisconnected doesn't race
  const watchdogRetryingRef = useRef(false)

  const startSignaling = useCallback(() => {
    watchdogRetryingRef.current = false
    // Defensively clear stale timers before starting new ones
    if (mediaWatchdogRef.current) {
      clearTimeout(mediaWatchdogRef.current)
      mediaWatchdogRef.current = null
    }
    if (mediaVerifyRef.current) {
      clearInterval(mediaVerifyRef.current)
      mediaVerifyRef.current = null
    }
    // Start media watchdog: if actual video frames aren't decoded within timeout, retry
    const watchdogCheck: () => void = () => {
      mediaWatchdogRef.current = null
      if (manualDisconnectRef.current || !mountedRef.current) return

      // Check for actual decoded video frames, not just ICE connection state
      const v = recv.videoRef.current
      const hasVideo = v && v.videoWidth > 0 && v.readyState >= 2
      if (hasVideo) return // video is actually playing

      if (mediaRetryCountRef.current >= MAX_MEDIA_RETRIES) {
        console.log(`[WebRTC] No video after ${MAX_MEDIA_RETRIES} retries — giving up`)
        setConnectionState('failed')
        setStatusMessage('Could not establish video after multiple retries')
        return
      }

      const recvOk = recv.recvConnectedRef.current
      const sendOk = send.sendConnectedRef.current

      if (recvOk && sendOk) {
        // ICE is connected but video hasn't decoded yet — log stats to diagnose
        const pc = recv.recvPcRef?.current
        if (pc) {
          pc.getStats().then(stats => {
            stats.forEach((report: Record<string, unknown>) => {
              if (report.type === 'inbound-rtp' && report.kind === 'video') {
                console.log(`[WebRTC] RECV video: pkts=${report.packetsReceived} lost=${report.packetsLost} framesRecv=${report.framesReceived} framesDec=${report.framesDecoded} drop=${report.framesDropped} bytes=${report.bytesReceived} codec=${report.codecId}`)
              }
              if (report.type === 'codec') {
                console.log(`[WebRTC] Codec: ${report.id} ${report.mimeType} pt=${report.payloadType} clock=${report.clockRate}`)
              }
            })
          })
        }

        mediaRetryCountRef.current++
        console.log(`[WebRTC] ICE connected, waiting for video (${mediaRetryCountRef.current}/${MAX_MEDIA_RETRIES})`)

        mediaWatchdogRef.current = setTimeout(watchdogCheck, MEDIA_TIMEOUT_MS)
        return
      }

      // Check if RECV ICE is actively connecting (not failed) — give it more time
      // Firefox's ICE checking takes longer than Chrome due to more candidate types
      const recvPc = recv.recvPcRef?.current
      const recvIceState = recvPc?.iceConnectionState
      if (recvIceState === 'checking' || recvIceState === 'new') {
        mediaRetryCountRef.current++
        console.log(`[WebRTC] No video frames after ${MEDIA_TIMEOUT_MS / 1000}s (recv=${recvOk}, send=${sendOk}) — RECV ICE still ${recvIceState}, waiting...`)
        mediaWatchdogRef.current = setTimeout(watchdogCheck, MEDIA_TIMEOUT_MS)
        return
      }

      // ICE not connected and not actively checking — full teardown and retry
      mediaRetryCountRef.current++
      console.log(`[WebRTC] No video frames after ${MEDIA_TIMEOUT_MS / 1000}s (recv=${recvOk}, send=${sendOk}) — retry ${mediaRetryCountRef.current}/${MAX_MEDIA_RETRIES}`)
      // Suppress onDisconnected from racing with this retry
      watchdogRetryingRef.current = true
      // Tear down first, then wait for robot to process peer-left before reconnecting
      teardownAll()
      setStatusMessage('Connecting...')
      retryTimerRef.current = setTimeout(() => {
        if (mountedRef.current && !manualDisconnectRef.current) {
          connectRef.current()
        }
      }, 1000)
    }
    watchdogCheckRef.current = watchdogCheck
    mediaWatchdogRef.current = setTimeout(watchdogCheck, MEDIA_TIMEOUT_MS)

    signaling.connect({
      onConnecting: () => {
        setConnectionState('connecting')
        setStatusMessage('Connecting...')
        setRejectionReason(null)
      },
      onDisconnected: () => {
        if (manualDisconnectRef.current) return
        // Watchdog already tore down and scheduled its own retry — don't race it
        if (watchdogRetryingRef.current) return
        // Cap retries (shared counter with watchdog)
        if (mediaRetryCountRef.current >= MAX_MEDIA_RETRIES) {
          setConnectionState('failed')
          setStatusMessage('Could not establish stable connection after multiple retries')
          return
        }
        mediaRetryCountRef.current++
        console.log(`[WebRTC] WebSocket lost — retry ${mediaRetryCountRef.current}/${MAX_MEDIA_RETRIES}`)
        // Connection was lost — auto-retry after a delay
        teardownAll()
        setConnectionState('connecting')
        setStatusMessage('Connection lost, reconnecting...')
        onConnectionChange?.(false)
        if (mountedRef.current) {
          retryTimerRef.current = setTimeout(() => {
            if (mountedRef.current) connectRef.current()
          }, 3000)
        }
      },
      onError: () => {
        setConnectionState('failed')
        setStatusMessage('Could not reach robot')
      },
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- signaling is stable via ref
  }, [teardownAll, onConnectionChange])

  const hasConnectedBeforeRef = useRef(false)

  const connect = useCallback(() => {
    manualDisconnectRef.current = false
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    teardownAll()
    setConnectionState('connecting')
    setStatusMessage('Connecting...')
    setRejectionReason(null)

    if (hasConnectedBeforeRef.current) {
      // Delay reconnection so robot has time to process peer-left and clear active_operator
      retryTimerRef.current = setTimeout(() => {
        if (mountedRef.current && !manualDisconnectRef.current) startSignaling()
      }, 1000)
    } else {
      hasConnectedBeforeRef.current = true
      startSignaling()
    }
  }, [teardownAll, startSignaling])

  // Stable ref so retry timer always calls latest connect
  const connectRef = useRef(connect)
  connectRef.current = connect

  // Mount tracking only. Connect is now a user-initiated action — see the
  // "Connect" button in ConnectingOverlay or the VREntryOverlay onEnter
  // handler. This avoids the "page-load + remount + reload" multi-session
  // churn that was killing webrtc_node with rapid pipeline create/destroy.
  useEffect(() => {
    mountedRef.current = true
    if (cleanupTimerRef.current) {
      clearTimeout(cleanupTimerRef.current)
      cleanupTimerRef.current = null
    }

    return () => {
      mountedRef.current = false
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
      cleanupTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) {
          teardownAll()
          onConnectionChange?.(false)
        }
      }, 50)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, [])

  return (
    <WebRTCContext.Provider
      value={{
        connectionState,
        connect,
        disconnect,
        sendTeleopCommand: send.sendTeleopCommand,
        sendControlMessage: send.sendControlMessage,
        videoRef: recv.videoRef,
        statusMessage,
        rejectionReason,
        isManualDisconnect: manualDisconnectRef.current,
        startOperatorMedia: media.startOperatorMedia,
        stopOperatorMedia: media.stopOperatorMedia,
        isOperatorMediaActive: media.isOperatorMediaActive,
      }}
    >
      {children}
    </WebRTCContext.Provider>
  )
}
