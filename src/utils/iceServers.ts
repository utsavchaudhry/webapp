/**
 * ICE server configuration for WebRTC connections.
 *
 * Always includes TURN for mobile compatibility (symmetric NAT requires relay).
 * ICE naturally prefers direct paths over relay on desktop.
 *
 * Fetches short-lived TURN credentials from /api/turn (Cloudflare Pages Function)
 * and caches them for 1 hour. Keeps total servers under 5 for Firefox compatibility.
 */

let cachedTurn: RTCIceServer[] | null = null
let cacheTime = 0
const CACHE_TTL = 3600_000 // 1 hour

const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
]

// Keep under 5 ICE servers total — Firefox slows down with more
const KEEP_TURN = new Set([
  'turn:turn.cloudflare.com:3478?transport=udp',   // primary relay
  'turns:turn.cloudflare.com:443?transport=tcp',    // fallback for restrictive networks
])

async function fetchTurnServers(): Promise<RTCIceServer[]> {
  if (cachedTurn && Date.now() - cacheTime < CACHE_TTL) {
    return cachedTurn
  }

  try {
    const res = await fetch('/api/turn')
    if (res.ok) {
      const data = await res.json()
      const raw = data?.iceServers
      const entries: RTCIceServer[] = (Array.isArray(raw) ? raw : raw ? [raw] : [])
        .map((e: RTCIceServer) => {
          if (Array.isArray(e.urls)) {
            const filtered = e.urls.filter(u =>
              (!u.startsWith('stun') && !u.startsWith('turn')) || KEEP_TURN.has(u)
            )
            return { ...e, urls: filtered }
          }
          return e
        })
        .filter((e: RTCIceServer) => e.urls && (Array.isArray(e.urls) ? e.urls.length > 0 : true))
      if (entries.length > 0) {
        cachedTurn = entries
        cacheTime = Date.now()
        return entries
      }
      if (data?.error) {
        console.log(`[WebRTC] TURN API: ${data.error}`)
      }
    }
  } catch {
    // /api/turn not available (local dev, or function not deployed)
  }

  // Fallback: build-time env vars
  const turnUrls = import.meta.env.VITE_TURN_URLS
  const turnUser = import.meta.env.VITE_TURN_USERNAME
  const turnCred = import.meta.env.VITE_TURN_CREDENTIAL
  if (turnUrls && turnUser && turnCred) {
    const urls = turnUrls.split(',').map((u: string) => u.trim()).filter(Boolean)
    if (urls.length) {
      return [{ urls, username: turnUser, credential: turnCred }]
    }
  }

  return []
}

/**
 * Get ICE servers. Always includes STUN + TURN.
 * Mobile carriers use symmetric NAT requiring TURN relay.
 * Desktop ICE naturally prefers direct paths over relay.
 */
export async function getIceServers(): Promise<RTCIceServer[]> {
  const turn = await fetchTurnServers()
  if (turn.length > 0) {
    const turnUrls = turn.flatMap(e => Array.isArray(e.urls) ? e.urls : [e.urls]).filter(u => u?.startsWith('turn'))
    console.log(`[WebRTC] TURN configured: ${turnUrls.length} relay URL(s)`)
    return [...STUN_SERVERS, ...turn]
  }

  console.log('[WebRTC] No TURN server — STUN only (may fail on mobile)')
  return STUN_SERVERS
}
