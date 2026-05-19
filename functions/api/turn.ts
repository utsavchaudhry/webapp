/**
 * Cloudflare Pages Function — generates short-lived TURN credentials
 * via the Cloudflare Calls TURN API.
 *
 * Required env vars (set in Pages dashboard → Settings → Environment Variables):
 *   CF_TURN_KEY_ID    — TURN key ID from Cloudflare Dashboard → Calls → TURN Keys
 *   CF_TURN_API_TOKEN — API token with Calls:Edit permission
 */

interface Env {
  CF_TURN_KEY_ID: string
  CF_TURN_API_TOKEN: string
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { CF_TURN_KEY_ID, CF_TURN_API_TOKEN } = context.env

  if (!CF_TURN_KEY_ID || !CF_TURN_API_TOKEN) {
    return Response.json(
      { iceServers: null, error: 'TURN not configured' },
      { status: 200 }
    )
  }

  try {
    const resp = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${CF_TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${CF_TURN_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl: 86400 }),
      }
    )

    if (!resp.ok) {
      const text = await resp.text()
      console.error(`Cloudflare TURN API error: ${resp.status} ${text}`)
      return Response.json(
        { iceServers: null, error: `TURN API: ${resp.status}` },
        { status: 200 }
      )
    }

    const data = await resp.json() as { iceServers: { urls: string[]; username: string; credential: string } }
    return Response.json(data, {
      headers: { 'Cache-Control': 'max-age=3600' },
    })
  } catch (e) {
    return Response.json(
      { iceServers: null, error: String(e) },
      { status: 200 }
    )
  }
}
