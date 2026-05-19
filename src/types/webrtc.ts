import React from 'react'

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'failed' | 'rejected'

export interface Vec3 { x: number; y: number; z: number }
export interface Quat { x: number; y: number; z: number; w: number }
export interface Pose { position: Vec3; orientation: Quat }

export interface TeleopCommand {
  type: 'teleop_command'
  mode: string
  left_arm?: {
    command_type: string
    delta_position?: { x: number; y: number; z: number }
    gripper_position?: number
  }
  right_arm?: {
    command_type: string
    delta_position?: { x: number; y: number; z: number }
    gripper_position?: number
  }
  head?: {
    delta_rotation?: { pitch: number; yaw: number; roll: number }
  }
  drive?: {
    linear: number   // forward/backward, -1 to +1
    angular: number  // turn left/right, -1 to +1
  }
  // VR / ik_control fields. Poses are in Unity world frame (the WebXR client
  // converts three.js → Unity before sending; see utils/threeToUnityPose.ts).
  head_pose?: Pose
  left_controller_pose?: Pose
  right_controller_pose?: Pose
  timestamp_us?: number
  sequence_number?: number
}

export interface WebRTCContextValue {
  connectionState: ConnectionState
  connect: () => void
  disconnect: () => void
  sendTeleopCommand: (command: TeleopCommand) => void
  // Generic JSON sender for non-teleop control messages (stream_mode, camera_switch, …).
  // Routes through the same 'control' DataChannel.
  sendControlMessage: (obj: Record<string, unknown>) => void
  videoRef: React.RefObject<HTMLVideoElement>
  statusMessage: string
  rejectionReason: string | null
  isManualDisconnect: boolean
  startOperatorMedia: (options?: {
    video?: boolean | { width?: number; height?: number; framerate?: number; bitrate?: number }
    audio?: boolean | { bitrate?: number }
  }) => Promise<void>
  stopOperatorMedia: () => void
  isOperatorMediaActive: boolean
}

export interface WebRTCProviderProps {
  children: React.ReactNode
  onConnectionChange?: (connected: boolean) => void
}

export interface SignalingHandlers {
  onRecvOffer: (ws: WebSocket, sdp: string) => void
  onSendAnswer: (sdp: string) => void
  onRecvIce: (candidate: RTCIceCandidateInit) => void
  onSendIce: (candidate: RTCIceCandidateInit) => void
  onSendRegistered: (ws: WebSocket) => void
  onSessionRejected: (reason: string) => void
}
