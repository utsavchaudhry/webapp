import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

interface VideoPlaneProps {
  video: HTMLVideoElement | null
  // Distance in metres from the head to the plane (negative Z in headspace).
  distance?: number
  // Plane width in metres. Height is derived from per-eye aspect of the source.
  width?: number
}

// Head-locked SBS stereo display with mono fallback.
//
// Three planes parented to a group that copies the active camera's transform
// each frame (HUD-style head lock):
//
//   * mono fallback  (layer 0, right half of SBS source)
//       Visible to every camera by default — every camera renders layer 0
//       unless we explicitly disable it. This is what XR runtimes that do
//       NOT expose proper sub-cameras (IWE polyfill, anything not
//       multi-view aware) will see. Equivalent to flat-mode behavior.
//   * left eye       (layer 1, left half of SBS source, z slightly closer)
//       Only visible to left XR sub-camera (StereoLayerSetup enables layer 1
//       on cameras[0]). Z-occludes the mono in the left eye.
//   * right eye      (layer 2, right half of SBS source, z slightly closer)
//       Only visible to right XR sub-camera. Z-occludes mono in right eye.
//
// On real Quest/PICO: layers 1/2 reach their respective eyes → stereo wins.
// On polyfilled/non-stereo runtimes: layers 1/2 are invisible to that
// runtime's single camera → user falls through to the mono right-eye view.
//
// For mono (non-SBS) sources, all three planes display the full frame and
// the SBS-vs-mono logic collapses to "everyone sees the same thing" — both
// eyes get the same image regardless of layer routing, which is exactly
// what you want for a mono camera in VR.
export function VideoPlane({ video, distance = 1.5, width = 2.0 }: VideoPlaneProps) {
  const groupRef = useRef<THREE.Group>(null)

  useFrame(({ camera }) => {
    if (!groupRef.current) return
    groupRef.current.position.copy(camera.position)
    groupRef.current.quaternion.copy(camera.quaternion)
  })

  // Detect SBS via aspect: SBS frame is 2:1 (e.g. 2400x1200). Threshold 1.95
  // gives a touch of slack against floating-point and slight non-square pixels.
  const [isSBS, setIsSBS] = useState(false)
  useEffect(() => {
    if (!video) return
    const check = () => {
      const w = video.videoWidth, h = video.videoHeight
      setIsSBS(w > 0 && h > 0 && (w / h) >= 1.95)
    }
    check()
    video.addEventListener('loadedmetadata', check)
    video.addEventListener('resize', check)
    return () => {
      video.removeEventListener('loadedmetadata', check)
      video.removeEventListener('resize', check)
    }
  }, [video])

  // Slightly closer than the mono plane so per-eye stereo z-occludes it
  // wherever its layer is enabled. ~1cm is plenty at this distance.
  const stereoZ = distance - 0.01

  return (
    <group ref={groupRef}>
      <EyePlane
        video={video} isSBS={isSBS}
        eye="right" distance={distance} width={width} layer={0}
      />
      <EyePlane
        video={video} isSBS={isSBS}
        eye="left" distance={stereoZ} width={width} layer={1}
      />
      <EyePlane
        video={video} isSBS={isSBS}
        eye="right" distance={stereoZ} width={width} layer={2}
      />
    </group>
  )
}

interface EyePlaneProps {
  video: HTMLVideoElement | null
  isSBS: boolean
  eye: 'left' | 'right'
  distance: number
  width: number
  // Scene-graph layer this mesh sits on — determines which camera(s) see it.
  layer: number
}

function EyePlane({ video, isSBS, eye, distance, width, layer }: EyePlaneProps) {
  const meshRef = useRef<THREE.Mesh | null>(null)

  // Each plane needs its OWN VideoTexture: offset/repeat is per-texture state.
  // Sharing one would force every plane to display the same UV window.
  const texture = useMemo(() => {
    if (!video) return null
    const t = new THREE.VideoTexture(video)
    t.colorSpace = THREE.SRGBColorSpace
    t.minFilter = THREE.LinearFilter
    t.magFilter = THREE.LinearFilter
    return t
  }, [video])

  // Apply / re-apply UV crop when SBS detection flips. Mono source = show the
  // full frame on every plane; SBS = each plane shows its half.
  useEffect(() => {
    if (!texture) return
    if (isSBS) {
      texture.offset.x = eye === 'left' ? 0 : 0.5
      texture.repeat.x = 0.5
    } else {
      texture.offset.x = 0
      texture.repeat.x = 1
    }
  }, [texture, isSBS, eye])

  // Resize mesh to the source's effective per-eye aspect.
  useEffect(() => {
    if (!video || !meshRef.current) return
    const apply = () => {
      const vw = video.videoWidth, vh = video.videoHeight
      if (vw === 0 || vh === 0) return
      const effectiveW = isSBS ? vw / 2 : vw
      const aspect = effectiveW / vh
      const height = width / aspect
      meshRef.current!.scale.set(width, height, 1)
    }
    apply()
    video.addEventListener('loadedmetadata', apply)
    video.addEventListener('resize', apply)
    return () => {
      video.removeEventListener('loadedmetadata', apply)
      video.removeEventListener('resize', apply)
    }
  }, [video, width, isSBS])

  useEffect(() => {
    if (meshRef.current) meshRef.current.layers.set(layer)
  }, [layer])

  useEffect(() => () => texture?.dispose(), [texture])

  if (!texture) return null
  return (
    <mesh ref={meshRef} position={[0, 0, -distance]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={texture} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  )
}
