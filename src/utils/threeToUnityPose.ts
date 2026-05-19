import type { Vector3, Quaternion } from 'three'
import type { Pose } from '../types/webrtc'

/**
 * Convert a three.js / WebXR pose to the Unity-world-frame pose the robot expects.
 *
 *   three.js: right-handed, +X right, +Y up, +Z toward viewer (camera looks at -Z).
 *   Unity:    left-handed,  +X right, +Y up, +Z forward (away from camera).
 *
 * Position: flip Z. Quaternion: standard right→left handedness flip with Z
 * preserved, which is (qx, qy, qz, qw) → (-qx, -qy, qz, qw).
 *
 * The robot's humanoid_kinematics_node feeds the result into unity_pose_to_ros_se3
 * to land in ROS (right-handed, +X forward, +Y left, +Z up). Keeping the
 * conversion client-side means the WebXR client looks identical to the Unity
 * client on the wire — robot side stays untouched.
 */
export function threeToUnityPose(position: Vector3, quaternion: Quaternion): Pose {
  return {
    position: {
      x: position.x,
      y: position.y,
      z: -position.z,
    },
    orientation: {
      x: -quaternion.x,
      y: -quaternion.y,
      z: quaternion.z,
      w: quaternion.w,
    },
  }
}
