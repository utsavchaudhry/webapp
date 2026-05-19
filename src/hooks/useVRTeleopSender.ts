import { useFrame, useThree } from '@react-three/fiber'
import { useXRInputSourceState, useXRStore } from '@react-three/xr'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useWebRTC } from '../contexts/WebRTCContext'
import { threeToUnityPose } from '../utils/threeToUnityPose'
import {
  computeAndSaveCalibration,
  loadCalibrationScale,
} from '../utils/vrCalibration'
import type { TeleopCommand } from '../types/webrtc'

// ─────────────────────────────────────────────────────────────────────────────
// Send rate: match the robot teleop_controller's `_cmd_dt = 0.02` (50 Hz).
// Headsets render 72/90/120 Hz; sending every frame floods the data channel
// and the IK loop is the actual bottleneck downstream.
const SEND_HZ = 50
const SEND_INTERVAL_MS = 1000 / SEND_HZ

// Calibration constants, helpers, and ROBOT_ARM_REACH_M live in
// utils/vrCalibration so the calibration overlay and the teleop sender can
// share a single source of truth (and the CalibrationScene can save without
// duplicating logic).

// xr-standard-gamepad button indices on Quest / PICO / WMR:
//   0 = trigger, 1 = grip/squeeze, 2 = touchpad, 3 = thumbstick click,
//   4 = primary (A on right / X on left), 5 = secondary (B / Y)
const BTN_TRIGGER = 0
const BTN_SECONDARY = 5

// xr-standard-gamepad axes:
//   0/1 = touchpad (rarely populated on Quest), 2/3 = thumbstick
// Quest 3 controllers always populate 2/3.
const AXIS_THUMB_X = 2
const AXIS_THUMB_Y = 3

// ─────────────────────────────────────────────────────────────────────────────
// Scratch math objects — kept outside useFrame to avoid per-frame allocations.

const _hmdPos = new THREE.Vector3()
const _hmdQuat = new THREE.Quaternion()
const _scaleVec = new THREE.Vector3()
const _leftPos = new THREE.Vector3()
const _leftQuat = new THREE.Quaternion()
const _rightPos = new THREE.Vector3()
const _rightQuat = new THREE.Quaternion()
const _scaledRel = new THREE.Vector3()
const _scaledWorld = new THREE.Vector3()

// ─────────────────────────────────────────────────────────────────────────────

// Reading controller pose from `useXRInputSourceState(...).object.matrixWorld`
// is unreliable: that Group's transform is updated by r3f-xr during render,
// not before useFrame callbacks fire, so we get an identity matrix back
// (positions all 0, quaternion 0,0,0,1). Instead, query the WebXR API
// directly each frame: XRFrame.getPose(inputSource.gripSpace, referenceSpace)
// returns the actual current pose in the reference frame.
function readPoseFromXRFrame(
  xrFrame: XRFrame,
  refSpace: XRReferenceSpace | XRBoundedReferenceSpace,
  inputSource: XRInputSource,
  outPos: THREE.Vector3,
  outQuat: THREE.Quaternion,
): boolean {
  const space = inputSource.gripSpace ?? inputSource.targetRaySpace
  const pose = xrFrame.getPose(space, refSpace)
  if (!pose) return false
  const t = pose.transform
  outPos.set(t.position.x, t.position.y, t.position.z)
  outQuat.set(t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w)
  return true
}

// Right thumbstick → drive. Returns { linear, angular } each in [-1, 1].
function readDrive(gamepad: Gamepad | null | undefined) {
  if (!gamepad) return { linear: 0, angular: 0 }
  const a = gamepad.axes
  // Prefer xr-standard thumbstick axes; fall back to 0/1 for runtimes
  // that only expose a single axis pair.
  const x = a[AXIS_THUMB_X] ?? a[0] ?? 0
  const y = a[AXIS_THUMB_Y] ?? a[1] ?? 0
  const dead = 0.15
  const ax = Math.abs(x) < dead ? 0 : x
  const ay = Math.abs(y) < dead ? 0 : y
  // Stick-up (negative axis-y) → forward; stick-right (+axis-x) → turn right.
  // ROS Twist.angular.z > 0 means CCW = turn-left, so negate axis-X here
  // to get the intuitive "push stick right → robot turns right" mapping.
  return { linear: -ay, angular: -ax }
}

// Trigger value [0, 1] → gripper position. -1 sentinel means "no command"
// so the robot doesn't drift the gripper when input is missing.
function readGrip(gamepad: Gamepad | null | undefined): number {
  if (!gamepad) return -1
  return gamepad.buttons[BTN_TRIGGER]?.value ?? -1
}

function buttonPressed(gamepad: Gamepad | null | undefined, idx: number): boolean {
  return !!gamepad?.buttons[idx]?.pressed
}

// ─────────────────────────────────────────────────────────────────────────────

export function useVRTeleopSender() {
  const { sendTeleopCommand } = useWebRTC()
  const xrStore = useXRStore()
  const gl = useThree((s) => s.gl)
  const left = useXRInputSourceState('controller', 'left')
  const right = useXRInputSourceState('controller', 'right')

  const lastSendMs = useRef(0)
  const seqRef = useRef(0)
  // calibrationScale = ROBOT_ARM_REACH_M / user_arm_span. Multiply head-relative
  // controller position by this to land on the robot's workspace scale.
  const calibrationScaleRef = useRef<number>(loadCalibrationScale() ?? 1)
  const calibButtonPrevRef = useRef(false)

  useEffect(() => {
    console.log(
      `[VR] Loaded calibration scale = ${calibrationScaleRef.current.toFixed(3)} ` +
      `(press LEFT-Y in T-pose to recalibrate)`,
    )
  }, [])

  useFrame((state, _delta, xrFrame) => {
    const session = xrStore.getState().session
    if (!session) return

    const now = performance.now()
    if (now - lastSendMs.current < SEND_INTERVAL_MS) return
    lastSendMs.current = now

    // ── HMD pose (head yaw/pitch + position) ─────────────────────────────
    state.camera.matrixWorld.decompose(_hmdPos, _hmdQuat, _scaleVec)
    const headPose = threeToUnityPose(_hmdPos, _hmdQuat)

    // ── Controller poses, queried directly from WebXR XRFrame ────────────
    // (See readPoseFromXRFrame comment for why we don't use .object.matrixWorld.)
    if (!xrFrame) return
    const refSpace = gl.xr?.getReferenceSpace?.() ?? null
    if (!refSpace) return

    let leftReady = false
    let rightReady = false
    for (const src of xrFrame.session.inputSources) {
      if (src.handedness === 'left') {
        leftReady = readPoseFromXRFrame(xrFrame, refSpace, src, _leftPos, _leftQuat)
      } else if (src.handedness === 'right') {
        rightReady = readPoseFromXRFrame(xrFrame, refSpace, src, _rightPos, _rightQuat)
      }
    }
    if (!leftReady || !rightReady) return

    // ── Calibration trigger: rising edge of LEFT secondary (Y button) ────
    // Stretch arms out in a T-pose, then press Y. Recomputes the user→robot
    // scale and persists it to localStorage.
    const leftGp = left?.inputSource?.gamepad
    const calibPressed = buttonPressed(leftGp, BTN_SECONDARY)
    if (calibPressed && !calibButtonPrevRef.current) {
      const leftDist = _leftPos.distanceTo(_hmdPos)
      const rightDist = _rightPos.distanceTo(_hmdPos)
      const avgArmSpan = (leftDist + rightDist) / 2
      const result = computeAndSaveCalibration(avgArmSpan)
      if (typeof result === 'number') {
        calibrationScaleRef.current = result
        console.log(
          `[VR] Recalibrated: arm_span=${avgArmSpan.toFixed(3)}m → ` +
          `scale=${result.toFixed(3)}`,
        )
      } else {
        console.warn(`[VR] Recalibration rejected: ${result}`)
      }
    }
    calibButtonPrevRef.current = calibPressed

    // ── Apply calibration scale to controller positions around the head ──
    // The robot's IK solver treats head pose as origin and the controller
    // position-relative-to-head as the target. Scaling here makes user
    // reach distance map onto robot workspace distance.
    const scale = calibrationScaleRef.current

    _scaledRel.copy(_leftPos).sub(_hmdPos).multiplyScalar(scale)
    _scaledWorld.copy(_hmdPos).add(_scaledRel)
    const leftPose = threeToUnityPose(_scaledWorld, _leftQuat)

    _scaledRel.copy(_rightPos).sub(_hmdPos).multiplyScalar(scale)
    _scaledWorld.copy(_hmdPos).add(_scaledRel)
    const rightPose = threeToUnityPose(_scaledWorld, _rightQuat)

    // ── Drive: right thumbstick only (left stays free for future use) ────
    const drive = readDrive(right?.inputSource?.gamepad)

    const cmd: TeleopCommand = {
      type: 'teleop_command',
      mode: 'ik_control',
      head_pose: headPose,
      left_controller_pose: leftPose,
      right_controller_pose: rightPose,
      left_arm: {
        command_type: 'end_effector_pose',
        gripper_position: readGrip(left?.inputSource?.gamepad),
      },
      right_arm: {
        command_type: 'end_effector_pose',
        gripper_position: readGrip(right?.inputSource?.gamepad),
      },
      // Skip the drive field when both axes are at zero so teleop_controller's
      // watchdog doesn't treat "operator is here" as "wheels should be live".
      ...(Math.abs(drive.linear) > 1e-3 || Math.abs(drive.angular) > 1e-3
        ? { drive }
        : {}),
      timestamp_us: Math.round(now * 1000),
      sequence_number: ++seqRef.current,
    }
    sendTeleopCommand(cmd)
  })
}
