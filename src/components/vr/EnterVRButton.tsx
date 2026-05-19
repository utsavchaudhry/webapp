interface EnterVRButtonProps {
  onEnter: () => void
  disabled?: boolean
}

// Opt-in VR entry button — caller (App.tsx) decides when to render based on
// useVRMode. No internal capability check; rendering this means "we want it
// shown". Used for the 'available' VR mode (WebXR works but device isn't a
// known 6DOF headset, so default-flat with VR as opt-in).
export function EnterVRButton({ onEnter, disabled }: EnterVRButtonProps) {
  return (
    <button
      type="button"
      onClick={onEnter}
      disabled={disabled}
      style={{
        padding: '8px 14px',
        borderRadius: 6,
        border: '1px solid #6366f1',
        background: disabled ? '#1f2937' : '#4f46e5',
        color: '#fff',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontWeight: 600,
        fontSize: 14,
      }}
    >
      Enter VR
    </button>
  )
}
