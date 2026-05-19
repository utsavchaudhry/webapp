import { useRef, useCallback } from 'react'
import { normalizeSdp } from '../utils/normalizeSdp'
import { getIceServers } from '../utils/iceServers'

interface UseRecvConnectionParams {
  sessionIdRef: React.RefObject<string>
  onConnectionStateUpdate: () => void
}

export function useRecvConnection({ sessionIdRef, onConnectionStateUpdate }: UseRecvConnectionParams) {
  const recvPcRef = useRef<RTCPeerConnection | null>(null)
  const recvRemoteSetRef = useRef(false)
  const recvIceQueueRef = useRef<RTCIceCandidateInit[]>([])
  const recvConnectedRef = useRef(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  // Serialize offer handling — chain promises so renegotiation waits for setup
  const offerChainRef = useRef<Promise<void>>(Promise.resolve())

  const log = useCallback((msg: string) => {
    console.log(`[WebRTC] ${msg}`)
  }, [])

  const flushRecvIceQueue = useCallback(() => {
    while (recvIceQueueRef.current.length > 0 && recvPcRef.current) {
      const candidate = recvIceQueueRef.current.shift()
      if (candidate) {
        recvPcRef.current.addIceCandidate(candidate)
          .catch(e => log(`[RECV] addIceCandidate error: ${e}`))
      }
    }
  }, [log])

  const handleOffer = useCallback(async (ws: WebSocket, offerSdp: string) => {
    const sdp = normalizeSdp(offerSdp)

    // Renegotiation: reuse existing PC if one already exists
    if (recvPcRef.current) {
      log('[RECV] Renegotiation — updating existing connection')
      await recvPcRef.current.setRemoteDescription({ type: 'offer', sdp })
      log('[RECV] Remote description updated')

      const answer = await recvPcRef.current.createAnswer()
      await recvPcRef.current.setLocalDescription(answer)
      log('[RECV] Local description (answer) set')

      ws.send(JSON.stringify({
        type: 'answer',
        sdp: recvPcRef.current.localDescription!.sdp,
        target: 'robot'
      }))
      log('[RECV] Answer sent to robot (renegotiation)')
      flushRecvIceQueue()
      return
    }

    log('[RECV] Setting up receive connection')

    const iceServers = await getIceServers()
    const pc = new RTCPeerConnection({ iceServers })
    recvPcRef.current = pc
    // NOTE: recvRemoteSetRef stays false until setRemoteDescription completes
    // so ICE candidates arriving before that are queued, not added directly.
    // Firefox fails if addIceCandidate is called before setRemoteDescription.

    pc.ontrack = (e) => {
      log(`[RECV] Track received: ${e.track.kind}`)
      if (!videoRef.current) return
      const video = videoRef.current

      if (e.track.kind === 'video') {
        // Set srcObject only for video track — GStreamer webrtcbin may put
        // audio in a separate MediaStream; blindly setting srcObject for
        // every track overwrites the video stream on mobile browsers.
        const stream = e.streams?.[0] ?? new MediaStream([e.track])
        video.srcObject = stream
        video.muted = true
        video.setAttribute('playsinline', 'true')
        video.play().catch(() => {})
        log(`[RECV] Video stream attached (paused=${video.paused}, muted=${video.muted})`)
      } else if (e.track.kind === 'audio') {
        // Merge audio into existing video stream instead of replacing srcObject
        if (video.srcObject instanceof MediaStream && !video.srcObject.getAudioTracks().length) {
          try { video.srcObject.addTrack(e.track) } catch { /* remote stream may be read-only */ }
        }
        log('[RECV] Audio track added to stream')
      }
    }

    const recvClientId = `operator_${sessionIdRef.current}_recv`
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        log(`[RECV] Local ICE candidate: ${e.candidate.candidate.split(' ').slice(0, 5).join(' ')}...`)
        ws.send(JSON.stringify({
          type: 'ice',
          candidate: e.candidate.candidate,
          sdpMLineIndex: e.candidate.sdpMLineIndex,
          sdpMid: e.candidate.sdpMid,
          target: 'robot',
          from: recvClientId
        }))
      } else {
        log('[RECV] ICE gathering complete')
      }
    }

    pc.onicegatheringstatechange = () => {
      log(`[RECV] ICE gathering state: ${pc.iceGatheringState}`)
    }

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      log(`[RECV] connectionState: ${state}`)
      if (state === 'connected') {
        recvConnectedRef.current = true
        log('[RECV] Connection established')
        // Mobile browsers often need srcObject re-assignment after ICE completes
        // to kick the decoder into producing frames
        const v = videoRef.current
        if (v?.srcObject) {
          const stream = v.srcObject
          v.srcObject = null
          v.srcObject = stream
          v.muted = true
          v.play().catch(() => {})
          log('[RECV] Video srcObject re-triggered for mobile')
        }
        onConnectionStateUpdate()
      } else if (state === 'failed' || state === 'disconnected') {
        recvConnectedRef.current = false
        log(`[RECV] Connection ${state}`)
        onConnectionStateUpdate()
      }
    }

    await pc.setRemoteDescription({ type: 'offer', sdp })
    recvRemoteSetRef.current = true
    flushRecvIceQueue()
    // Log codec info from SDP offer for debugging
    const codecLines = sdp.split('\n').filter((l: string) => l.startsWith('m=video') || l.startsWith('a=rtpmap:'))
    log(`[RECV] SDP codecs: ${codecLines.map((l: string) => l.trim()).join(' | ')}`)
    log('[RECV] Remote description set')

    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    log('[RECV] Local description (answer) set')

    ws.send(JSON.stringify({
      type: 'answer',
      sdp: pc.localDescription!.sdp,
      target: 'robot'
    }))
    log('[RECV] Answer sent to robot')

    flushRecvIceQueue()
  }, [log, flushRecvIceQueue, onConnectionStateUpdate, sessionIdRef])

  // Serialized entry point — chains offers so renegotiation waits for initial setup
  const setupRecvConnection = useCallback((ws: WebSocket, offerSdp: string) => {
    offerChainRef.current = offerChainRef.current
      .then(() => handleOffer(ws, offerSdp))
      .catch(error => {
        log(`[RECV] Setup error: ${error}`)
        if (!recvPcRef.current) {
          recvRemoteSetRef.current = false
        }
      })
    return offerChainRef.current
  }, [handleOffer, log])

  const addRecvIceCandidate = useCallback((candidate: RTCIceCandidateInit) => {
    if (recvPcRef.current && recvRemoteSetRef.current) {
      recvPcRef.current.addIceCandidate(candidate)
        .catch(e => log(`[RECV] addIceCandidate error: ${e}`))
    } else {
      recvIceQueueRef.current.push(candidate)
    }
  }, [log])

  const teardownRecv = useCallback(() => {
    if (recvPcRef.current) {
      recvPcRef.current.close()
      recvPcRef.current = null
    }
    recvRemoteSetRef.current = false
    recvIceQueueRef.current = []
    recvConnectedRef.current = false
    offerChainRef.current = Promise.resolve()
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }, [])

  return {
    videoRef,
    recvPcRef,
    recvConnectedRef,
    recvRemoteSetRef,
    setupRecvConnection,
    addRecvIceCandidate,
    teardownRecv,
  }
}
