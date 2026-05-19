import { useRef, useCallback } from 'react'
import type { SignalingHandlers } from '../types/webrtc'

interface UseSignalingParams {
  handlersRef: React.MutableRefObject<SignalingHandlers>
}

export function useSignaling({ handlersRef }: UseSignalingParams) {
  const wsRef = useRef<WebSocket | null>(null)
  const sessionIdRef = useRef<string>(Math.random().toString(36).substring(2, 8))
  const sessionRejectedRef = useRef(false)
  const waitingForRecvOfferRef = useRef(false)

  const log = useCallback((msg: string) => {
    console.log(`[WebRTC] ${msg}`)
  }, [])

  const disconnectSignaling = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
  }, [])

  const connect = useCallback((
    callbacks: {
      onConnecting: () => void
      onDisconnected: () => void
      onError: () => void
    }
  ) => {
    const wsUrl = import.meta.env.DEV
      ? 'ws://localhost:8443'
      : (import.meta.env.VITE_SIGNALING_URL || 'wss://utsavchaudhary.us')

    // Generate a fresh session ID for each connection attempt
    sessionIdRef.current = Math.random().toString(36).substring(2, 8)
    const recvClientId = `operator_${sessionIdRef.current}_recv`
    const sendClientId = `operator_${sessionIdRef.current}_send`

    log(`Connecting to ${wsUrl} (session: ${sessionIdRef.current})`)
    sessionRejectedRef.current = false
    callbacks.onConnecting()

    let wasOpen = false

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      if (wsRef.current !== ws) return // stale — replaced by a newer connection
      wasOpen = true
      log('WebSocket connected')
      waitingForRecvOfferRef.current = true
      ws.send(JSON.stringify({
        type: 'register',
        client_id: recvClientId
      }))
      log(`Registered as ${recvClientId} - waiting for offer`)
    }

    ws.onerror = (error) => {
      if (wsRef.current !== ws) return
      log(`WebSocket error: ${error}`)
    }

    ws.onclose = () => {
      if (wsRef.current !== ws) return // stale — new connection already replaced this one
      log('WebSocket closed')
      if (sessionRejectedRef.current) return

      if (wasOpen) {
        // Was connected then lost — recoverable disconnect
        callbacks.onDisconnected()
      } else {
        // Never connected — unreachable
        callbacks.onError()
      }
    }

    ws.onmessage = (ev) => {
      if (wsRef.current !== ws) return
      const msg = JSON.parse(ev.data)
      const from = msg.from
      const target = msg.target || msg.peer_id

      log(`recv: ${msg.type} (from: ${from || 'unknown'}, target: ${target || 'unknown'})`)

      const handlers = handlersRef.current

      // Handle session rejection from robot
      if (msg.type === 'session_rejected') {
        const reason = msg.reason || 'Robot is currently in use by another operator.'
        log(`Session rejected: ${reason}`)
        sessionRejectedRef.current = true
        handlers.onSessionRejected(reason)
        return
      }

      // Handle registration acknowledgment
      if (msg.type === 'registered') {
        const clientId = msg.client_id || 'operator'
        log(`Registered as ${clientId}`)
        if (clientId === recvClientId) {
          // Recv registered — now register the send client
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'register',
              client_id: sendClientId
            }))
            log(`Registered as ${sendClientId}`)
          }
        } else if (clientId === sendClientId) {
          // Send registered — create the send connection
          handlers.onSendRegistered(ws)
        }
        return
      }

      // Answer for send connection (robot answers our offer)
      if (msg.type === 'answer' && msg.sdp && (target === sendClientId || from === 'robot')) {
        handlers.onSendAnswer(msg.sdp)
        return
      }

      // Offer from robot (for recv connection)
      if (msg.type === 'offer' && msg.sdp && from === 'robot') {
        if (target === recvClientId) {
          log('[RECV] Offer received from robot - setting up recv connection')
          waitingForRecvOfferRef.current = false
          handlers.onRecvOffer(ws, msg.sdp)
        } else if (target === sendClientId) {
          log('[SEND] Ignoring robot offer for send connection (browser is the offerer)')
        } else if (!target && waitingForRecvOfferRef.current) {
          log('[RECV] Offer received (no target) - setting up recv connection')
          waitingForRecvOfferRef.current = false
          handlers.onRecvOffer(ws, msg.sdp)
        }
        return
      }

      // ICE candidates
      if (msg.type === 'ice' && msg.candidate && from === 'robot') {
        const iceCandidate = {
          candidate: msg.candidate,
          sdpMLineIndex: msg.sdpMLineIndex,
          sdpMid: msg.sdpMid
        }

        if (target === recvClientId) {
          handlers.onRecvIce(iceCandidate)
        } else if (target === sendClientId) {
          handlers.onSendIce(iceCandidate)
        }
      }
    }
  }, [log, handlersRef])

  return {
    connect,
    disconnectSignaling,
    sessionIdRef,
    wsRef,
  }
}
