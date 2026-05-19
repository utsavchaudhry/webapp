import { useRef, useCallback } from 'react'
import { normalizeSdp } from '../utils/normalizeSdp'
import { getIceServers } from '../utils/iceServers'
import type { TeleopCommand } from '../types/webrtc'

const HEARTBEAT_INTERVAL_MS = 5000

export interface RobotConfig {
  enable_operator_media?: boolean
  // Robot may extend this in the future; we accept unknown keys.
  [k: string]: unknown
}

interface UseSendConnectionParams {
  sessionIdRef: React.RefObject<string>
  onConnectionStateUpdate: () => void
  onDataChannelsReady?: () => void
  onSessionEnded?: (reason: string) => void
  onRobotConfig?: (config: RobotConfig) => void
}

export function useSendConnection({ sessionIdRef, onConnectionStateUpdate, onDataChannelsReady, onSessionEnded, onRobotConfig }: UseSendConnectionParams) {
  const sendPcRef = useRef<RTCPeerConnection | null>(null)
  const sendRemoteSetRef = useRef(false)
  const sendIceQueueRef = useRef<RTCIceCandidateInit[]>([])
  const sendConnectedRef = useRef(false)

  const controlChannelRef = useRef<RTCDataChannel | null>(null)
  const videoChannelRef = useRef<RTCDataChannel | null>(null)
  const audioChannelRef = useRef<RTCDataChannel | null>(null)

  const waitingForSendAnswerRef = useRef(false)
  const dataChannelsReadyFiredRef = useRef(false)
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const log = useCallback((msg: string) => {
    console.log(`[WebRTC] ${msg}`)
  }, [])

  const flushSendIceQueue = useCallback(() => {
    while (sendIceQueueRef.current.length > 0 && sendPcRef.current) {
      const candidate = sendIceQueueRef.current.shift()
      if (candidate) {
        sendPcRef.current.addIceCandidate(candidate)
          .catch(e => log(`[SEND] addIceCandidate error: ${e}`))
      }
    }
  }, [log])

  const sendTeleopCommand = useCallback((command: TeleopCommand) => {
    if (controlChannelRef.current && controlChannelRef.current.readyState === 'open') {
      controlChannelRef.current.send(JSON.stringify(command))
      log(`Sent command: ${command.type} mode=${command.mode}`)
    } else {
      log(`Control channel not open (state: ${controlChannelRef.current?.readyState || 'null'})`)
    }
  }, [log])

  // Generic JSON sender for non-teleop messages (stream_mode, camera_switch, etc.).
  // Keeps TeleopCommand schema clean while letting callers ship arbitrary {type,...}
  // payloads the robot's _on_control_channel_message dispatches on.
  const sendControlMessage = useCallback((obj: Record<string, unknown>) => {
    if (controlChannelRef.current?.readyState === 'open') {
      controlChannelRef.current.send(JSON.stringify(obj))
      log(`Sent control msg: type=${String(obj.type)}`)
    } else {
      log(`Control channel not open for control msg (state: ${controlChannelRef.current?.readyState || 'null'})`)
    }
  }, [log])

  const createSendOfferAndSend = useCallback(async (ws: WebSocket) => {
    if (sendPcRef.current) {
      log('[SEND] PC already exists, skip creating offer')
      return
    }
    try {
      log('[SEND] Creating send connection (data channels only, browser offers)')
      const iceServers = await getIceServers()
      const pc = new RTCPeerConnection({ iceServers })
      sendPcRef.current = pc

      // Create 3 data channels with appropriate QoS
      dataChannelsReadyFiredRef.current = false

      const checkAllChannelsReady = () => {
        if (
          !dataChannelsReadyFiredRef.current &&
          controlChannelRef.current?.readyState === 'open' &&
          videoChannelRef.current?.readyState === 'open' &&
          audioChannelRef.current?.readyState === 'open'
        ) {
          dataChannelsReadyFiredRef.current = true
          log('[SEND] All data channels open')
          onDataChannelsReady?.()
        }
      }

      const control = pc.createDataChannel('control', { ordered: true })
      controlChannelRef.current = control
      control.onopen = () => {
        log('[SEND] Control data channel open')
        // Start heartbeat
        if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current)
        heartbeatTimerRef.current = setInterval(() => {
          if (control.readyState === 'open') {
            control.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }))
          }
        }, HEARTBEAT_INTERVAL_MS)
        checkAllChannelsReady()
      }
      control.onclose = () => {
        log('[SEND] Control data channel closed')
        if (heartbeatTimerRef.current) {
          clearInterval(heartbeatTimerRef.current)
          heartbeatTimerRef.current = null
        }
      }
      control.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'session_ended') {
            log(`[SEND] Session ended by robot: ${msg.reason}`)
            onSessionEnded?.(msg.reason || 'Session ended by robot.')
          } else if (msg.type === 'config') {
            log(`[SEND] Robot config: ${JSON.stringify(msg)}`)
            onRobotConfig?.(msg)
          }
        } catch { /* ignore non-JSON */ }
      }

      const video = pc.createDataChannel('video', {
        ordered: false,
        maxRetransmits: 0
      })
      videoChannelRef.current = video
      video.binaryType = 'arraybuffer'
      video.onopen = () => {
        log('[SEND] Video data channel open')
        checkAllChannelsReady()
      }
      video.onclose = () => log('[SEND] Video data channel closed')

      const audio = pc.createDataChannel('audio', {
        ordered: true,
        maxRetransmits: 2
      })
      audioChannelRef.current = audio
      audio.binaryType = 'arraybuffer'
      audio.onopen = () => {
        log('[SEND] Audio data channel open')
        checkAllChannelsReady()
      }
      audio.onclose = () => log('[SEND] Audio data channel closed')

      const sendClientId = `operator_${sessionIdRef.current}_send`
      pc.onicecandidate = (e) => {
        if (e.candidate && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'ice',
            candidate: e.candidate.candidate,
            sdpMLineIndex: e.candidate.sdpMLineIndex,
            sdpMid: e.candidate.sdpMid,
            target: 'robot',
            from: sendClientId
          }))
        }
      }

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState
        log(`[SEND] connectionState: ${state}`)
        if (state === 'connected') {
          sendConnectedRef.current = true
          log('[SEND] Connection established')
          onConnectionStateUpdate()
        } else if (state === 'disconnected' || state === 'failed') {
          sendConnectedRef.current = false
          log(`[SEND] Connection ${state}`)
          onConnectionStateUpdate()
        }
      }

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      log('[SEND] Offer created and sent to robot (data channels only)')
      ws.send(JSON.stringify({
        type: 'offer',
        sdp: pc.localDescription!.sdp,
        target: 'robot',
        from: sendClientId
      }))
      waitingForSendAnswerRef.current = true
    } catch (err) {
      log(`[SEND] Create offer error: ${err}`)
      throw err
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onSessionEnded / onRobotConfig are stable via ref in parent
  }, [log, onConnectionStateUpdate, onDataChannelsReady, sessionIdRef])

  const handleSendAnswer = useCallback((sdp: string) => {
    if (sendPcRef.current && waitingForSendAnswerRef.current) {
      waitingForSendAnswerRef.current = false
      log('[SEND] Answer received from robot')
      const answerSdp = normalizeSdp(sdp)
      sendPcRef.current.setRemoteDescription({ type: 'answer', sdp: answerSdp })
        .then(() => {
          sendRemoteSetRef.current = true
          flushSendIceQueue()
          log('[SEND] Remote description (answer) set')
        })
        .catch(e => log(`[SEND] setRemoteDescription error: ${e}`))
    }
  }, [log, flushSendIceQueue])

  const addSendIceCandidate = useCallback((candidate: RTCIceCandidateInit) => {
    if (sendPcRef.current && sendRemoteSetRef.current) {
      sendPcRef.current.addIceCandidate(candidate)
        .catch(e => log(`[SEND] addIceCandidate error: ${e}`))
    } else {
      sendIceQueueRef.current.push(candidate)
    }
  }, [log])

  const teardownSend = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current)
      heartbeatTimerRef.current = null
    }
    if (sendPcRef.current) {
      sendPcRef.current.close()
      sendPcRef.current = null
    }
    controlChannelRef.current = null
    videoChannelRef.current = null
    audioChannelRef.current = null
    sendRemoteSetRef.current = false
    sendIceQueueRef.current = []
    sendConnectedRef.current = false
    waitingForSendAnswerRef.current = false
    dataChannelsReadyFiredRef.current = false
  }, [])

  return {
    sendConnectedRef,
    sendPcRef,
    controlChannelRef,
    videoChannelRef,
    audioChannelRef,
    waitingForSendAnswerRef,
    sendTeleopCommand,
    sendControlMessage,
    createSendOfferAndSend,
    handleSendAnswer,
    addSendIceCandidate,
    teardownSend,
  }
}
