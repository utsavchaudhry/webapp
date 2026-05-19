# webapp

Operator console for the robot stack at [utsavchaudhry/robot](https://github.com/utsavchaudhry/robot). React + Three.js + WebXR, deployed to Cloudflare Pages. Runs in three modes that auto-route based on the user's device:

- **Desktop** — flat browser, never WebXR (URL overrides ignored).
- **Phone** — flat by default. `?vr=force` opt-in for debugging WebXR on a phone-tier device.
- **Headset (Quest 2/3, Pico, Wolvic)** — auto-enters a WebXR session with stereo video, controller-driven IK, and head-tracked yaw/pitch.

## Stack

| | |
| - | - |
| UI            | React 18 + TypeScript + Vite                             |
| 3D / VR       | three.js + @react-three/fiber + @react-three/xr + drei  |
| Networking    | WebRTC (1× recv PC for media, 1× send PC for data channels) |
| Signaling     | WebSocket → Cloudflare Worker → robot's `signaling_server` |
| Hosting       | Cloudflare Pages (per-robot project)                     |

## Local development

```bash
npm install
npm run dev          # http://localhost:5173 (Vite default)
# or:
make dev
```

The signaling URL is baked at build time via `VITE_SIGNALING_URL`. In dev it defaults to whichever URL is in `.env.local`; `make dev` doesn't override it. For most local work you'll point the dev build at a robot's signaling endpoint directly.

## Deploy

Two Cloudflare Pages projects, one per physical robot:

| target            | bakes signaling URL into          | pushes to Pages project |
| ----------------- | --------------------------------- | ----------------------- |
| `make deploy-a`   | `wss://utsavchaudhary.us`         | `robot-control`         |
| `make deploy-b`   | `wss://robot-b.utsavchaudhary.us` | `robot-control-b`       |
| `make deploy-all` | both, sequentially                 | both                    |

**Convention:** `deploy-b` is the safe default. `deploy-a` ships to the production unit and requires explicit confirmation. Never invoke `wrangler pages deploy` directly — always go through the Makefile so you can't accidentally publish a `robot-b` build to the `robot-control` project.

## VR flow (Quest / Pico)

1. **First load on a device.** The app reads `localStorage[vr_calibration_scale]`. Absent → entry overlay shows "Tap to set up VR" and the WebRTC connect is *not* initiated.
2. **One-time calibration.** Tap → WebXR session opens with `CalibrationScene`. User stands in a T-pose and presses **LEFT-Y**. We measure the mean head→controller distance and store `scale = robot_arm_reach / user_arm_span` in localStorage. Validation enforces `0.4 m ≤ avg_arm_span ≤ 1.2 m` — outside that range the user is asked to retry. On success, the WebXR session ends.
3. **Subsequent loads.** Calibration present → entry overlay shows "Tap anywhere to enter VR" and the tap kicks off `connect()` + WebXR. Re-calibration mid-session is still possible by holding T-pose and pressing LEFT-Y again.
4. **In VR.** Head yaw/pitch → robot head servos. Controller positions (scaled by the calibration factor, relative to the head) → robot arm IK targets. Orientation is *not* fed to IK — only position. Right thumbstick → wheel `cmd_vel` (forward/back + turn). Triggers → grippers.

To clear calibration and re-trigger setup on a Quest, attach DevTools via `chrome://inspect`:

```js
localStorage.removeItem('vr_calibration_scale'); location.reload()
```

## Wire format

A single `teleop_command` JSON message flows over the `control` data channel at 50 Hz. VR mode uses `ik_control`:

```json
{
  "type": "teleop_command",
  "mode": "ik_control",
  "head_pose":              { "position": {...}, "orientation": {...} },
  "left_controller_pose":   { "position": {...}, "orientation": {...} },
  "right_controller_pose":  { "position": {...}, "orientation": {...} },
  "left_arm":  { "command_type": "end_effector_pose", "gripper_position": 0.7 },
  "right_arm": { "command_type": "end_effector_pose", "gripper_position": -1 },
  "drive":     { "linear": 0.4, "angular": -0.2 },
  "timestamp_us": 1234567890123,
  "sequence_number": 42
}
```

Poses are sent in three.js coordinates → converted to Unity convention by `threeToUnityPose` → converted again to ROS on the robot side by `unity_pose_to_ros_se3`. The double conversion is historical (the original client was Unity); the current code preserves the wire format so existing/future Unity clients keep working.

A `gripper_position` of `-1` is the "don't touch" sentinel; `0..1` maps to gripper open→close. The `drive` field is omitted when both axes are near zero so the robot's watchdog can distinguish "operator is here but resting" from "operator hasn't pushed the stick yet."

## Layout

```
src/
  components/
    vr/
      VREntryOverlay.tsx        tap-to-start overlay; switches copy + gates connect on calibration
      VRSession.tsx             owns the XR session; routes to calibration vs teleop scene
      CalibrationScene.tsx      one-time T-pose calibration UI inside VR
      VRScene.tsx               normal teleop scene (video planes + controllers + IK sender)
      VideoPlane.tsx            stereo SBS → per-eye head-locked planes
      StereoLayerSetup.tsx      r3f-xr layer routing (left/right eye masks)
      ControllerMarker.tsx      visible cube + ray on each controller
      EnterVRButton.tsx         classic in-page enter-VR button (unused on auto flow)
    VideoDisplay.tsx, ConnectingOverlay.tsx, ControlPanel.tsx,
    StatusBar.tsx
  contexts/
    WebRTCContext.tsx           two RTCPeerConnections, signaling, message routing
  hooks/
    useVRMode.ts                desktop/phone/headset routing policy
    useCalibration.ts           reactive view over localStorage[vr_calibration_scale]
    useVRTeleopSender.ts        per-frame controller/head pose → JSON @ 50 Hz
    useFullscreen.ts
  utils/
    vrCalibration.ts            persisted scale + validation bounds
    threeToUnityPose.ts         three.js → Unity coordinate flip
functions/                      Cloudflare Pages Functions (signaling proxy, TURN creds)
```

## Browsers tested

| browser                   | flat | VR         |
| ------------------------- | ---- | ---------- |
| Chrome / Edge (desktop)   | yes  | n/a (blocked) |
| Safari (desktop)          | yes  | n/a        |
| Meta Browser (Quest 2/3)  | yes  | yes        |
| Pico Browser (Pico 4)     | yes  | yes        |
| Mobile Chrome / Safari    | yes  | flat by default; `?vr=force` for testing |

For Quest dev, attach `chrome://inspect/#devices` from a USB-tethered laptop to get a full DevTools panel against the headset.
