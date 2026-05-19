import { useCallback, useEffect, useRef, useState } from "react"

export interface JoystickState {
  active: boolean
  knob: { x: number; y: number }
}

export interface UseVirtualJoystickProps {
  disabled?: boolean
  onChange: (x: number, y: number) => void
  onEnd?: () => void
  ignoreY?: boolean
  ignoreX?: boolean
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function useVirtualJoystick({
  disabled,
  onChange,
  onEnd,
  ignoreY,
  ignoreX,
}: UseVirtualJoystickProps) {
  const padRef = useRef<HTMLDivElement | null>(null)
  const [joystickState, setJoystickState] = useState<JoystickState>({
    active: false,
    knob: { x: 0, y: 0 },
  })
  const lastXY = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const rafRef = useRef<number | null>(null)
  const isProcessingRef = useRef(false)
  const pointerIdRef = useRef<number | null>(null)
  const isActiveRef = useRef(false)

  const processPoint = useCallback(
    (clientX: number, clientY: number) => {
      if (!padRef.current) return
      const rect = padRef.current.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2

      const dx = clientX - cx
      const dy = clientY - cy
      const r = rect.width / 2
      let nx = clamp(dx / r, -1, 1)
      let ny = clamp(dy / r, -1, 1)

      if (ignoreY) {
        ny = 0
        nx = clamp(nx, -1, 1)
      } else if (ignoreX) {
        nx = 0
        ny = clamp(ny, -1, 1)
      } else {
        const mag = Math.hypot(nx, ny)
        if (mag > 1) {
          nx /= mag
          ny /= mag
        }
      }

      lastXY.current = { x: nx, y: ny }
      setJoystickState((prev) => ({ ...prev, knob: { x: nx, y: ny } }))
    },
    [ignoreY, ignoreX],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || isActiveRef.current || isProcessingRef.current) return
      if (pointerIdRef.current !== null && pointerIdRef.current !== e.pointerId) return

      isProcessingRef.current = true
      pointerIdRef.current = e.pointerId
      isActiveRef.current = true

      try {
        (e.target as Element).setPointerCapture?.(e.pointerId)
      } catch {
        /* setPointerCapture not supported or failed */
      }

      setJoystickState((prev) => ({ ...prev, active: true }))
      processPoint(e.clientX, e.clientY)

      setTimeout(() => {
        isProcessingRef.current = false
      }, 50)

      e.preventDefault()
      e.stopPropagation()
    },
    [disabled, processPoint],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isActiveRef.current || pointerIdRef.current !== e.pointerId) return
      processPoint(e.clientX, e.clientY)
      e.preventDefault()
      e.stopPropagation()
    },
    [processPoint],
  )

  const onPointerLeave = useCallback((e: React.PointerEvent) => {
    if (!isActiveRef.current || pointerIdRef.current !== e.pointerId) return
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const end = useCallback(() => {
    if (!isActiveRef.current) return

    isActiveRef.current = false
    setJoystickState({ active: false, knob: { x: 0, y: 0 } })
    lastXY.current = { x: 0, y: 0 }
    isProcessingRef.current = false
    pointerIdRef.current = null
    onEnd?.()
  }, [onEnd])

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isActiveRef.current || pointerIdRef.current !== e.pointerId) return
      end()
      e.preventDefault()
      e.stopPropagation()
    },
    [end],
  )

  // Throttled update loop
  useEffect(() => {
    if (!joystickState.active) return

    let lastUpdate = 0
    const THROTTLE_MILLISECONDS = 16

    const tick = (timestamp: number) => {
      if (timestamp - lastUpdate >= THROTTLE_MILLISECONDS) {
        const { x, y } = lastXY.current
        onChange(x, y)
        lastUpdate = timestamp
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [joystickState.active, onChange])

  useEffect(() => {
    if (disabled && isActiveRef.current) {
      end()
    }
  }, [disabled, end])

  return {
    padRef,
    joystickState,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerLeave,
    },
  }
}
