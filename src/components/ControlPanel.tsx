import { useCallback, useState, useMemo } from 'react'
import VirtualJoystick from './controls/VirtualJoystick'
import { useWebRTC } from '../contexts/WebRTCContext'
import './ControlPanel.css'

type ControlMode = 'wheels' | 'head' | 'arms'

export const ControlPanel = () => {
  const { sendTeleopCommand } = useWebRTC()
  const [leftGripperClosed, setLeftGripperClosed] = useState(false)
  const [rightGripperClosed, setRightGripperClosed] = useState(false)
  const [controlMode, setControlMode] = useState<ControlMode>('wheels')

  // Responsive joystick sizes — fit side-by-side on any screen
  const { mainSize, fwdSize } = useMemo(() => {
    const w = window.innerWidth
    // Reserve ~50px for padding; split remaining between 2 joysticks + fwd sticks
    const available = w - 50
    const main = Math.min(160, Math.max(100, Math.floor(available / 3)))
    const fwd = Math.min(50, Math.max(36, Math.floor(main * 0.3)))
    return { mainSize: main, fwdSize: fwd }
  }, [])

  // Helper to ensure float values (ROS expects floats, not integers)
  const toFloat = (val: number): number => parseFloat(val.toFixed(6))

  // ── Gripper toggle handlers ──
  const handleLeftGripperToggle = useCallback(() => {
    const newState = !leftGripperClosed
    setLeftGripperClosed(newState)
    sendTeleopCommand({
      type: 'teleop_command',
      mode: 'thumbstick_control',
      left_arm: {
        command_type: 'thumbstick_delta',
        delta_position: { x: 0.0, y: 0.0, z: 0.0 },
        gripper_position: newState ? 0.0 : 1.0,
      }
    })
  }, [leftGripperClosed, sendTeleopCommand])

  const handleRightGripperToggle = useCallback(() => {
    const newState = !rightGripperClosed
    setRightGripperClosed(newState)
    sendTeleopCommand({
      type: 'teleop_command',
      mode: 'thumbstick_control',
      right_arm: {
        command_type: 'thumbstick_delta',
        delta_position: { x: 0.0, y: 0.0, z: 0.0 },
        gripper_position: newState ? 0.0 : 1.0,
      }
    })
  }, [rightGripperClosed, sendTeleopCommand])

  // ── Left Arm 2D Joystick (left/right + up/down) ──
  const handleLeftArmChange = useCallback((x: number, y: number) => {
    sendTeleopCommand({
      type: 'teleop_command',
      mode: 'thumbstick_control',
      left_arm: {
        command_type: 'thumbstick_delta',
        delta_position: {
          x: toFloat(x * 0.01),   // mapped to Y (left/right) by backend
          y: toFloat(y * 0.01),   // mapped to Z (up/down) by backend
          z: 0.0,
        },
        gripper_position: leftGripperClosed ? 0.0 : 1.0,
      }
    })
  }, [sendTeleopCommand, leftGripperClosed])

  const handleLeftArmEnd = useCallback(() => {
    sendTeleopCommand({
      type: 'teleop_command',
      mode: 'thumbstick_control',
      left_arm: {
        command_type: 'thumbstick_delta',
        delta_position: { x: 0.0, y: 0.0, z: 0.0 },
        gripper_position: leftGripperClosed ? 0.0 : 1.0,
      }
    })
  }, [sendTeleopCommand, leftGripperClosed])

  // ── Left Arm 1D Joystick (forward/back) ──
  const handleLeftFwdChange = useCallback((_x: number, y: number) => {
    // Vertical joystick: y=-1 (push up) = forward, y=+1 (push down) = backward
    sendTeleopCommand({
      type: 'teleop_command',
      mode: 'thumbstick_control',
      left_arm: {
        command_type: 'thumbstick_delta',
        delta_position: {
          x: 0.0,
          y: 0.0,
          z: toFloat(-y * 0.01),  // mapped to X (forward/back) by backend
        },
        gripper_position: leftGripperClosed ? 0.0 : 1.0,
      }
    })
  }, [sendTeleopCommand, leftGripperClosed])

  const handleLeftFwdEnd = useCallback(() => {
    sendTeleopCommand({
      type: 'teleop_command',
      mode: 'thumbstick_control',
      left_arm: {
        command_type: 'thumbstick_delta',
        delta_position: { x: 0.0, y: 0.0, z: 0.0 },
        gripper_position: leftGripperClosed ? 0.0 : 1.0,
      }
    })
  }, [sendTeleopCommand, leftGripperClosed])

  // ── Right Arm 2D Joystick (left/right + up/down) ──
  const handleRightArmChange = useCallback((x: number, y: number) => {
    sendTeleopCommand({
      type: 'teleop_command',
      mode: 'thumbstick_control',
      right_arm: {
        command_type: 'thumbstick_delta',
        delta_position: {
          x: toFloat(x * 0.01),
          y: toFloat(y * 0.01),
          z: 0.0,
        },
        gripper_position: rightGripperClosed ? 0.0 : 1.0,
      }
    })
  }, [sendTeleopCommand, rightGripperClosed])

  const handleRightArmEnd = useCallback(() => {
    sendTeleopCommand({
      type: 'teleop_command',
      mode: 'thumbstick_control',
      right_arm: {
        command_type: 'thumbstick_delta',
        delta_position: { x: 0.0, y: 0.0, z: 0.0 },
        gripper_position: rightGripperClosed ? 0.0 : 1.0,
      }
    })
  }, [sendTeleopCommand, rightGripperClosed])

  // ── Right Arm 1D Joystick (forward/back) ──
  const handleRightFwdChange = useCallback((_x: number, y: number) => {
    sendTeleopCommand({
      type: 'teleop_command',
      mode: 'thumbstick_control',
      right_arm: {
        command_type: 'thumbstick_delta',
        delta_position: {
          x: 0.0,
          y: 0.0,
          z: toFloat(-y * 0.01),
        },
        gripper_position: rightGripperClosed ? 0.0 : 1.0,
      }
    })
  }, [sendTeleopCommand, rightGripperClosed])

  const handleRightFwdEnd = useCallback(() => {
    sendTeleopCommand({
      type: 'teleop_command',
      mode: 'thumbstick_control',
      right_arm: {
        command_type: 'thumbstick_delta',
        delta_position: { x: 0.0, y: 0.0, z: 0.0 },
        gripper_position: rightGripperClosed ? 0.0 : 1.0,
      }
    })
  }, [sendTeleopCommand, rightGripperClosed])

  // ── Head Joystick ──
  const handleHeadChange = useCallback((x: number, y: number) => {
    sendTeleopCommand({
      type: 'teleop_command',
      mode: 'thumbstick_control',
      head: {
        delta_rotation: {
          pitch: toFloat(y * 0.01),
          yaw: toFloat(x * 0.01),
          roll: 0.0,
        },
      }
    })
  }, [sendTeleopCommand])

  const handleHeadEnd = useCallback(() => {
    sendTeleopCommand({
      type: 'teleop_command',
      mode: 'thumbstick_control',
      head: {
        delta_rotation: { pitch: 0.0, yaw: 0.0, roll: 0.0 },
      }
    })
  }, [sendTeleopCommand])

  // ── Drive Joystick (wheels) ──
  const handleDriveChange = useCallback((x: number, y: number) => {
    sendTeleopCommand({
      type: 'teleop_command',
      mode: 'thumbstick_control',
      drive: {
        linear: toFloat(-y),    // push up = forward
        angular: toFloat(-x),   // push right = turn right (robot POV)
      }
    })
  }, [sendTeleopCommand])

  const handleDriveEnd = useCallback(() => {
    sendTeleopCommand({
      type: 'teleop_command',
      mode: 'thumbstick_control',
      drive: { linear: 0.0, angular: 0.0 }
    })
  }, [sendTeleopCommand])

  // ── Default Pose Button ──
  const handleDefaultPose = useCallback(() => {
    sendTeleopCommand({
      type: 'teleop_command',
      mode: 'reset_to_default',
    })
  }, [sendTeleopCommand])

  return (
    <div className="control-panel">
      <div className="mode-sidebar">
        <button
          className={`mode-button ${controlMode === 'wheels' ? 'mode-active' : ''}`}
          onClick={() => setControlMode('wheels')}
        >🚗 Wheels</button>
        <button
          className={`mode-button ${controlMode === 'head' ? 'mode-active' : ''}`}
          onClick={() => setControlMode('head')}
        >👀 Head</button>
        <button
          className={`mode-button ${controlMode === 'arms' ? 'mode-active' : ''}`}
          onClick={() => setControlMode('arms')}
        >🦾 Arms</button>
        <button
          className="default-pose-button"
          onClick={handleDefaultPose}
        >🏠</button>
      </div>

      <div className={`joysticks-container ${controlMode !== 'arms' ? 'single-joystick' : ''}`}>
        {controlMode === 'wheels' && (
          <div className="arm-control">
            <div className="arm-header">🚗 Drive</div>
            <VirtualJoystick
              onChange={handleDriveChange}
              onEnd={handleDriveEnd}
              sizePx={mainSize}
            />
          </div>
        )}

        {controlMode === 'head' && (
          <div className="arm-control">
            <div className="arm-header">👀 Head</div>
            <VirtualJoystick
              onChange={handleHeadChange}
              onEnd={handleHeadEnd}
              sizePx={mainSize}
            />
          </div>
        )}

        {controlMode === 'arms' && (
          <>
            <div className="arm-control">
              <div className="arm-header">🤛 Left</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <VirtualJoystick
                  onChange={handleLeftFwdChange}
                  onEnd={handleLeftFwdEnd}
                  ignoreX
                  sizePx={fwdSize}
                  knobScale={0.5}
                  label="Fwd"
                />
                <VirtualJoystick
                  onChange={handleLeftArmChange}
                  onEnd={handleLeftArmEnd}
                  sizePx={mainSize}
                />
              </div>
              <button
                className={`gripper-button ${leftGripperClosed ? 'gripper-closed' : ''}`}
                onClick={handleLeftGripperToggle}
              >{leftGripperClosed ? '✊ Open' : '✋ Close'}</button>
            </div>

            <div className="arm-control">
              <div className="arm-header">🤜 Right</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <VirtualJoystick
                  onChange={handleRightArmChange}
                  onEnd={handleRightArmEnd}
                  sizePx={mainSize}
                />
                <VirtualJoystick
                  onChange={handleRightFwdChange}
                  onEnd={handleRightFwdEnd}
                  ignoreX
                  sizePx={fwdSize}
                  knobScale={0.5}
                  label="Fwd"
                />
              </div>
              <button
                className={`gripper-button ${rightGripperClosed ? 'gripper-closed' : ''}`}
                onClick={handleRightGripperToggle}
              >{rightGripperClosed ? '✊ Open' : '✋ Close'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
