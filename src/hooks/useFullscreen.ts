import { useState, useCallback, useEffect } from 'react'

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement)

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const enterFullscreen = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen()
      // Lock to landscape on mobile if supported
      const orient = screen.orientation as { lock?: (type: string) => Promise<void> }
      if (orient?.lock) {
        orient.lock('landscape').catch(() => {})
      }
    } catch { /* not supported or denied */ }
  }, [])

  return { isFullscreen, enterFullscreen }
}
