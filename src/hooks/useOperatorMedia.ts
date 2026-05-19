import { useRef, useState, useCallback } from 'react'

interface UseOperatorMediaParams {
  videoChannelRef: React.RefObject<RTCDataChannel | null>
  audioChannelRef: React.RefObject<RTCDataChannel | null>
  sendPcRef: React.RefObject<RTCPeerConnection | null>
}

export function useOperatorMedia({ videoChannelRef, audioChannelRef, sendPcRef }: UseOperatorMediaParams) {
  const [isOperatorMediaActive, setIsOperatorMediaActive] = useState(false)

  const operatorStreamRef = useRef<MediaStream | null>(null)
  const videoCaptureIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioCaptureNodeRef = useRef<AudioWorkletNode | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const animFrameRef = useRef<number>(0)
  const audioCtxRef = useRef<AudioContext | null>(null)

  const log = useCallback((msg: string) => {
    console.log(`[WebRTC] ${msg}`)
  }, [])

  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const captureActiveRef = useRef(false)

  const startVideoCapture = useCallback((sourceCanvas: HTMLCanvasElement) => {
    // Stop any previous capture loop
    captureActiveRef.current = false
    if (videoCaptureIntervalRef.current) {
      clearTimeout(videoCaptureIntervalRef.current as unknown as number)
      videoCaptureIntervalRef.current = null
    }

    const MAX_CAPTURE_DIM = 320 // max width or height
    const FRAME_INTERVAL = 67 // ~15fps target (ms between frames)
    const QUALITY = 0.4
    const MAX_MSG_SIZE = (() => {
      try {
        const sctp = sendPcRef.current?.sctp
        if (sctp && sctp.maxMessageSize > 0) return sctp.maxMessageSize
      } catch { /* ignore */ }
      return 64 * 1024
    })()

    // Compute downscale dimensions preserving source aspect ratio
    const srcW = sourceCanvas.width
    const srcH = sourceCanvas.height
    const captureScale = Math.min(MAX_CAPTURE_DIM / srcW, MAX_CAPTURE_DIM / srcH)
    const CAPTURE_W = Math.round(srcW * captureScale)
    const CAPTURE_H = Math.round(srcH * captureScale)

    // Offscreen canvas for downscaling
    let downCanvas = captureCanvasRef.current
    if (!downCanvas || downCanvas.width !== CAPTURE_W || downCanvas.height !== CAPTURE_H) {
      downCanvas = document.createElement('canvas')
      downCanvas.width = CAPTURE_W
      downCanvas.height = CAPTURE_H
      captureCanvasRef.current = downCanvas
    }
    const downCtx = downCanvas.getContext('2d')!

    captureActiveRef.current = true
    let lastSendTime = 0

    // Synchronous base64→ArrayBuffer (avoids async toBlob callback delay)
    const base64ToBuffer = (base64: string): ArrayBuffer => {
      const bin = atob(base64)
      const len = bin.length
      const bytes = new Uint8Array(len)
      for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i)
      return bytes.buffer
    }

    const captureFrame = () => {
      if (!captureActiveRef.current) return

      const vc = videoChannelRef.current
      if (!vc || vc.readyState !== 'open') {
        videoCaptureIntervalRef.current = setTimeout(captureFrame, FRAME_INTERVAL) as unknown as ReturnType<typeof setInterval>
        return
      }

      // Backpressure: skip frame if channel buffer is full
      if (vc.bufferedAmount > MAX_MSG_SIZE) {
        videoCaptureIntervalRef.current = setTimeout(captureFrame, FRAME_INTERVAL) as unknown as ReturnType<typeof setInterval>
        return
      }

      // Rate limit
      const now = performance.now()
      const elapsed = now - lastSendTime
      if (elapsed < FRAME_INTERVAL) {
        videoCaptureIntervalRef.current = setTimeout(captureFrame, FRAME_INTERVAL - elapsed) as unknown as ReturnType<typeof setInterval>
        return
      }

      // Downscale + encode synchronously (no async callback delay)
      downCtx.drawImage(sourceCanvas, 0, 0, CAPTURE_W, CAPTURE_H)
      const dataUrl = downCanvas!.toDataURL('image/jpeg', QUALITY)
      const base64 = dataUrl.substring(dataUrl.indexOf(',') + 1)
      const buf = base64ToBuffer(base64)

      if (buf.byteLength <= MAX_MSG_SIZE) {
        vc.send(buf)
        lastSendTime = performance.now()
      }

      // Schedule next frame
      videoCaptureIntervalRef.current = setTimeout(captureFrame, FRAME_INTERVAL) as unknown as ReturnType<typeof setInterval>
    }

    captureFrame()
    log(`Video capture started: ~${Math.round(1000 / FRAME_INTERVAL)} fps, ${CAPTURE_W}x${CAPTURE_H}, JPEG q=${QUALITY}, maxMsg ${MAX_MSG_SIZE}`)
  }, [log, videoChannelRef, sendPcRef])

  const startAudioCapture = useCallback(async (audioCtx: AudioContext, sourceNode: AudioNode) => {
    if (audioCaptureNodeRef.current) {
      audioCaptureNodeRef.current.disconnect()
    }

    await audioCtx.audioWorklet.addModule('/audio-capture-processor.js')
    const workletNode = new AudioWorkletNode(audioCtx, 'audio-capture-processor')
    audioCaptureNodeRef.current = workletNode

    workletNode.port.onmessage = (e) => {
      const ac = audioChannelRef.current
      if (!ac || ac.readyState !== 'open') return
      if (ac.bufferedAmount > 32 * 1024) return
      ac.send(e.data)
    }

    sourceNode.connect(workletNode)
    workletNode.connect(audioCtx.destination)
    log('Audio capture started (AudioWorklet, PCM Int16, mono)')
  }, [log, audioChannelRef])

  const stopOperatorMedia = useCallback(() => {
    captureActiveRef.current = false
    if (videoCaptureIntervalRef.current) {
      clearTimeout(videoCaptureIntervalRef.current as unknown as number)
      videoCaptureIntervalRef.current = null
    }
    if (audioCaptureNodeRef.current) {
      audioCaptureNodeRef.current.disconnect()
      audioCaptureNodeRef.current = null
    }
    if (operatorStreamRef.current) {
      operatorStreamRef.current.getTracks().forEach(track => track.stop())
      operatorStreamRef.current = null
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = 0
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
    canvasRef.current = null
    setIsOperatorMediaActive(false)
    log('Operator media stopped')
  }, [log])

  const startOperatorMedia = useCallback(async (options?: {
    video?: boolean | { width?: number; height?: number; framerate?: number; bitrate?: number }
    audio?: boolean | { bitrate?: number }
  }) => {
    try {
      const videoOpts = options?.video === false ? false :
                       (typeof options?.video === 'object' ? options.video : {})
      const audioOpts = options?.audio === false ? false :
                       (typeof options?.audio === 'object' ? options.audio : {})

      const defaultVideo = { width: 640, height: 480, framerate: 30 }
      const videoConstraints = videoOpts === false ? false : {
        width: videoOpts.width || defaultVideo.width,
        height: videoOpts.height || defaultVideo.height,
        frameRate: videoOpts.framerate || defaultVideo.framerate,
      }

      log('Requesting operator media access...')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: audioOpts === false ? false : {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })

      operatorStreamRef.current = stream
      setIsOperatorMediaActive(true)

      log(`Operator media started: ${stream.getVideoTracks().length} video, ${stream.getAudioTracks().length} audio`)

      const videoTrack = stream.getVideoTracks()[0]
      if (videoTrack) {
        const settings = videoTrack.getSettings()
        const w = settings.width || 640
        const h = settings.height || 480

        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvasRef.current = canvas

        const videoEl = document.createElement('video')
        videoEl.srcObject = new MediaStream([videoTrack])
        videoEl.play()

        const drawCtx = canvas.getContext('2d')!
        const drawLoop = () => {
          drawCtx.drawImage(videoEl, 0, 0, w, h)
          animFrameRef.current = requestAnimationFrame(drawLoop)
        }
        videoEl.onloadedmetadata = () => drawLoop()

        startVideoCapture(canvas)
        log(`Video capture: ${w}x${h}`)
      }

      const audioTrack = stream.getAudioTracks()[0]
      if (audioTrack) {
        const audioCtx = new AudioContext()
        audioCtxRef.current = audioCtx
        const source = audioCtx.createMediaStreamSource(new MediaStream([audioTrack]))
        await startAudioCapture(audioCtx, source)
      }

    } catch (error) {
      log(`Failed to get operator media: ${error}`)
      throw error
    }
  }, [log, startVideoCapture, startAudioCapture])

  const restartCaptureIfActive = useCallback(() => {
    if (canvasRef.current && !captureActiveRef.current) {
      startVideoCapture(canvasRef.current)
    }
  }, [startVideoCapture])

  const teardownMedia = useCallback(() => {
    captureActiveRef.current = false
    if (videoCaptureIntervalRef.current) {
      clearTimeout(videoCaptureIntervalRef.current as unknown as number)
      videoCaptureIntervalRef.current = null
    }
    if (audioCaptureNodeRef.current) {
      audioCaptureNodeRef.current.disconnect()
      audioCaptureNodeRef.current = null
    }
  }, [])

  return {
    isOperatorMediaActive,
    startOperatorMedia,
    stopOperatorMedia,
    restartCaptureIfActive,
    teardownMedia,
  }
}
