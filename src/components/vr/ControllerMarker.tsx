import { useXRInputSourceState } from '@react-three/xr'

interface ControllerMarkerProps {
  hand: 'left' | 'right'
}

// Small cube + forward-pointing ray attached to each controller's grip space so
// the user can see their hands inside the headset (default Quest controllers
// already render, but this also works when the runtime hides them).
export function ControllerMarker({ hand }: ControllerMarkerProps) {
  const controller = useXRInputSourceState('controller', hand)
  // controller.object can be undefined until the runtime has placed the input
  // source — render nothing until it's wired up.
  if (!controller?.object) return null

  const color = hand === 'left' ? '#3b82f6' : '#ef4444'

  // controller.object is a Group whose world transform tracks the gripSpace
  // (or targetRaySpace fallback). r3f mounts the children inside that group.
  return (
    <primitive object={controller.object}>
      <mesh>
        <boxGeometry args={[0.04, 0.04, 0.12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} />
      </mesh>
      <mesh position={[0, 0, -0.5]}>
        <cylinderGeometry args={[0.003, 0.003, 1, 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} />
      </mesh>
    </primitive>
  )
}
