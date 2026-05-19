import { useState, useEffect } from 'react'
import { VolumeX } from 'lucide-react'
import { useWebRTC } from '../contexts/WebRTCContext'
import './VideoDisplay.css'

export const VideoDisplay = () => {
  const { videoRef } = useWebRTC()
  const [isMuted, setIsMuted] = useState(true)

  // Unmute on any click/tap anywhere on the page — once
  useEffect(() => {
    if (!isMuted) return
    const unmute = () => {
      if (videoRef.current) {
        videoRef.current.muted = false
      }
      setIsMuted(false)
    }
    document.addEventListener('click', unmute, { once: true })
    return () => document.removeEventListener('click', unmute)
  }, [isMuted, videoRef])

  // SBS-aware crop: when the stream is 2:1 packed (left+right halves), show
  // only the right eye via `object-fit: cover` + `object-position: right`.
  // For a regular mono stream the inline style is omitted and the CSS
  // default (`object-fit: contain`) renders the whole frame as before.
  // Aspect threshold of 2.0 sits comfortably above mono 16:9 (≈1.78) and
  // below SBS 32:9 (≈3.55).
  const [isSBS, setIsSBS] = useState(false)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const check = () => {
      const w = video.videoWidth, h = video.videoHeight
      // SBS sources from a stereo camera are exactly 2:1 (e.g. 2400x1200, 2000x1000).
      // Mono 16:9 is 1.78. Use >= 1.95 so floating-point and slight non-square
      // pixels don't push a true SBS frame below the threshold.
      setIsSBS(w > 0 && h > 0 && (w / h) >= 1.95)
    }
    check()
    video.addEventListener('loadedmetadata', check)
    video.addEventListener('resize', check)
    return () => {
      video.removeEventListener('loadedmetadata', check)
      video.removeEventListener('resize', check)
    }
  }, [videoRef])

  // SBS path wraps the video in a 1:1 frame that scales to the container's
  // shorter axis. The video is 200% wide right-anchored, so only the right
  // eye is visible. Non-SBS path uses the existing object-fit: contain.
  //
  // The same <video> element is reused across both paths (no conditional
  // mount) so the WebRTC stream attached by useRecvConnection survives the
  // isSBS state flip.
  return (
    <div className="video-container">
      <div className={isSBS ? 'sbs-eye-frame' : 'video-passthrough'}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={isSBS ? 'video-element-sbs' : 'video-element'}
        />
      </div>
      {isMuted && (
        <div className="mute-toggle">
          <VolumeX size={20} />
          <span>Click anywhere to enable audio</span>
        </div>
      )}
    </div>
  )
}
