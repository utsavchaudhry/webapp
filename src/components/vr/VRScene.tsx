import { VideoPlane } from './VideoPlane'
import { ControllerMarker } from './ControllerMarker'
import { StereoLayerSetup } from './StereoLayerSetup'
import { useVRTeleopSender } from '../../hooks/useVRTeleopSender'

interface VRSceneProps {
  video: HTMLVideoElement | null
}

export function VRScene({ video }: VRSceneProps) {
  // The send loop reads camera + controller poses each frame and pushes
  // teleop_command JSON down the existing control DataChannel.
  useVRTeleopSender()

  return (
    <>
      {/* Enables layer 1 on left XR sub-camera and layer 2 on right.
          VideoPlane puts the per-eye stereo planes on layers 1 and 2 so
          each eye sees only its half of the SBS frame. Layer 0 (default,
          visible to every camera) carries a mono right-eye fallback for
          runtimes that don't expose proper multi-view cameras. */}
      <StereoLayerSetup />

      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 4, 2]} intensity={0.8} />

      {/* Floor grid for spatial reference (layer 0 → both eyes). */}
      <gridHelper args={[10, 20, '#4a5568', '#2d3748']} position={[0, 0, 0]} />

      <VideoPlane video={video} />

      <ControllerMarker hand="left" />
      <ControllerMarker hand="right" />
    </>
  )
}
