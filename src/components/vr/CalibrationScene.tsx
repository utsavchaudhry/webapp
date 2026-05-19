import { useFrame, useThree } from '@react-three/fiber'
import { useXRStore } from '@react-three/xr'
import { Text } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { computeAndSaveCalibration } from '../../utils/vrCalibration'
import { ControllerMarker } from './ControllerMarker'
import { StereoLayerSetup } from './StereoLayerSetup'

// ─────────────────────────────────────────────────────────────────────────────
// One-time in-VR calibration. The user enters VR (without a robot connection),
// stretches into a T-pose, and presses LEFT-Y. We measure head→controller
// distances, validate, persist the user→robot scale, and end the WebXR
// session. The parent (VRSession) listens for session.end() and re-renders
// with calibration in place.

const BTN_SECONDARY = 5

const _hmdPos = new THREE.Vector3()
const _hmdQuat = new THREE.Quaternion()
const _scale = new THREE.Vector3()
const _leftPos = new THREE.Vector3()
const _leftQuat = new THREE.Quaternion()
const _rightPos = new THREE.Vector3()
const _rightQuat = new THREE.Quaternion()

function readControllerPose(
  xrFrame: XRFrame,
  refSpace: XRReferenceSpace | XRBoundedReferenceSpace,
  src: XRInputSource,
  outPos: THREE.Vector3,
  outQuat: THREE.Quaternion,
): boolean {
  const space = src.gripSpace ?? src.targetRaySpace
  const pose = xrFrame.getPose(space, refSpace)
  if (!pose) return false
  const t = pose.transform
  outPos.set(t.position.x, t.position.y, t.position.z)
  outQuat.set(t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w)
  return true
}

type Status =
  | { kind: 'waiting' }
  | { kind: 'error'; message: string; until: number }
  | { kind: 'success'; scale: number; until: number }

interface CalibrationSceneProps {
  onComplete: () => void
}

export function CalibrationScene({ onComplete }: CalibrationSceneProps) {
  const xrStore = useXRStore()
  const gl = useThree((s) => s.gl)
  const [status, setStatus] = useState<Status>({ kind: 'waiting' })
  const buttonPrevRef = useRef(false)
  const exitedRef = useRef(false)

  // After a successful save, give the user ~1.5 s to see the confirmation,
  // then end the WebXR session. The parent watches store.session for null
  // and rotates VRSession into the teleop scene.
  useEffect(() => {
    if (status.kind !== 'success') return
    const remaining = Math.max(0, status.until - performance.now())
    const id = window.setTimeout(() => {
      if (exitedRef.current) return
      exitedRef.current = true
      onComplete()
    }, remaining)
    return () => window.clearTimeout(id)
  }, [status, onComplete])

  useFrame((state, _delta, xrFrame) => {
    if (!xrFrame) return
    const session = xrStore.getState().session
    if (!session) return
    const refSpace = gl.xr?.getReferenceSpace?.() ?? null
    if (!refSpace) return

    state.camera.matrixWorld.decompose(_hmdPos, _hmdQuat, _scale)

    // Drop transient banners (errors / success) back to waiting after their
    // display window. The success-state's exit timer fires from useEffect
    // above, not here.
    if (status.kind === 'error' && performance.now() > status.until) {
      setStatus({ kind: 'waiting' })
    }

    let leftOk = false
    let rightOk = false
    let leftGamepad: Gamepad | null = null
    for (const src of xrFrame.session.inputSources) {
      if (src.handedness === 'left') {
        leftOk = readControllerPose(xrFrame, refSpace, src, _leftPos, _leftQuat)
        leftGamepad = src.gamepad ?? null
      } else if (src.handedness === 'right') {
        rightOk = readControllerPose(xrFrame, refSpace, src, _rightPos, _rightQuat)
      }
    }

    const calibPressed = !!leftGamepad?.buttons[BTN_SECONDARY]?.pressed
    const rising = calibPressed && !buttonPrevRef.current
    buttonPrevRef.current = calibPressed

    if (!rising) return
    if (status.kind === 'success') return // already done; waiting to exit
    if (!leftOk || !rightOk) {
      setStatus({
        kind: 'error',
        message: 'Both controllers must be tracked. Move them into view and try again.',
        until: performance.now() + 2500,
      })
      return
    }

    const avg = (_leftPos.distanceTo(_hmdPos) + _rightPos.distanceTo(_hmdPos)) / 2
    const result = computeAndSaveCalibration(avg)
    if (typeof result === 'number') {
      console.log(`[VR] Initial calibration: arm_span=${avg.toFixed(3)}m → scale=${result.toFixed(3)}`)
      setStatus({ kind: 'success', scale: result, until: performance.now() + 1500 })
    } else {
      setStatus({ kind: 'error', message: result, until: performance.now() + 2500 })
    }
  })

  return (
    <>
      <StereoLayerSetup />
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 4, 2]} intensity={0.8} />
      <gridHelper args={[10, 20, '#4a5568', '#2d3748']} />

      <ControllerMarker hand="left" />
      <ControllerMarker hand="right" />

      <Instructions status={status} />
    </>
  )
}

function Instructions({ status }: { status: Status }) {
  // Position the panel ~2 m in front of the user, eye-height. drei's Text
  // is a regular three Object3D so layer 0 (both eyes) is fine — there's
  // nothing eye-specific to render here.
  const headlineColor =
    status.kind === 'success' ? '#22c55e' :
    status.kind === 'error' ? '#ef4444' :
    '#f8fafc'

  const headline =
    status.kind === 'success' ? '✓ Calibrated' :
    status.kind === 'error' ? 'Try again' :
    'One-time setup'

  const detail =
    status.kind === 'success' ? `Scale ${status.scale.toFixed(2)} saved. Continuing…` :
    status.kind === 'error' ? status.message :
    'Stand with both arms straight out to the sides (T-pose), then press the Y button on your LEFT controller.'

  return (
    <group position={[0, 1.5, -2]}>
      <Text
        position={[0, 0.4, 0]}
        fontSize={0.18}
        color={headlineColor}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.005}
        outlineColor="#000"
      >
        {headline}
      </Text>
      <Text
        position={[0, 0.05, 0]}
        fontSize={0.08}
        color="#e2e8f0"
        maxWidth={3}
        anchorX="center"
        anchorY="middle"
        textAlign="center"
        outlineWidth={0.003}
        outlineColor="#000"
      >
        {detail}
      </Text>
      {status.kind === 'waiting' && (
        <Text
          position={[0, -0.25, 0]}
          fontSize={0.05}
          color="#94a3b8"
          anchorX="center"
          anchorY="middle"
        >
          Your reach determines how your hands map to the robot's arms.
        </Text>
      )}
    </group>
  )
}
