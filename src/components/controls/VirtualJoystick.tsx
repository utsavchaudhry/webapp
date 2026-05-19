import { memo } from "react"
import { useVirtualJoystick } from "./useVirtualJoystick"
import styles from "./VirtualJoystick.module.css"

interface VirtualJoystickProps {
  disabled?: boolean
  onChange: (x: number, y: number) => void
  onEnd?: () => void
  ignoreY?: boolean
  ignoreX?: boolean
  sizePx?: number
  knobScale?: number
  label?: string
}

const VirtualJoystick = memo(function VirtualJoystick({
  disabled = false,
  onChange,
  onEnd,
  ignoreY = false,
  ignoreX = false,
  sizePx = 180,
  knobScale = 0.38,
  label,
}: VirtualJoystickProps) {
  const { padRef, joystickState, handlers } = useVirtualJoystick({
    disabled,
    onChange,
    onEnd,
    ignoreY,
    ignoreX,
  })

  const knobSize = sizePx * knobScale
  const radius = sizePx / 2 - knobSize / 2
  const translateX = joystickState.knob.x * radius
  const translateY = joystickState.knob.y * radius

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
      {label && (
        <div style={{ 
          fontSize: '12px', 
          color: 'rgba(255, 255, 255, 0.7)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          fontWeight: 500
        }}>
          {label}
        </div>
      )}
      <div
        ref={padRef}
        className={`${styles.pad} ${disabled ? styles.disabled : ""} ${joystickState.active ? styles.active : ""}`}
        style={{
          width: sizePx,
          height: sizePx,
        }}
        onPointerDown={handlers.onPointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerCancel={handlers.onPointerUp}
        onPointerLeave={handlers.onPointerLeave}
      >
        <div aria-hidden className={styles.crosshairVertical} />
        <div aria-hidden className={styles.crosshairHorizontal} />

        <div
          className={`${styles.knob} ${joystickState.active ? styles.active : ""}`}
          style={{
            width: knobSize,
            height: knobSize,
            transform: `translate3d(calc(-50% + ${translateX}px), calc(-50% + ${translateY}px), 0)`,
            WebkitTransform: `translate3d(calc(-50% + ${translateX}px), calc(-50% + ${translateY}px), 0)`,
          }}
        />
      </div>
    </div>
  )
})

export default VirtualJoystick
