/**
 * SDP normalization — fix GStreamer quirks for browser compatibility.
 * Strips a=rtcp-mux-only and payload types > 127 (e.g. pt=255 for
 * telephone-event emitted by GStreamer webrtcbin, rejected by browsers).
 * Ensures H264 fmtp and NACK feedback attributes are present.
 */
export function normalizeSdp(sdp: string): string {
  if (typeof sdp !== 'string') return ''
  const lines = sdp.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

  // Pass 1: find invalid PTs and clean m= lines
  const invalidPts = new Set<string>()
  const cleaned: string[] = []
  for (let line of lines) {
    if (line.trim() === 'a=rtcp-mux-only') continue
    if (line.startsWith('m=')) {
      const parts = line.split(' ')
      if (parts.length >= 4) {
        const header = parts.slice(0, 3)
        const validPts: string[] = []
        for (const pt of parts.slice(3)) {
          const n = parseInt(pt, 10)
          if (!isNaN(n) && n > 127) {
            invalidPts.add(pt)
          } else {
            validPts.push(pt)
          }
        }
        if (validPts.length === 0) {
          header[1] = '0'
          validPts.push('0')
        }
        line = [...header, ...validPts].join(' ')
      }
    }
    cleaned.push(line)
  }

  // Pass 2: strip attribute lines for invalid PTs
  const out = invalidPts.size > 0
    ? cleaned.filter((line) => {
        for (const pt of invalidPts) {
          if (line.startsWith(`a=rtpmap:${pt} `) ||
              line.startsWith(`a=fmtp:${pt} `) ||
              line.startsWith(`a=rtcp-fb:${pt} `)) {
            return false
          }
        }
        return true
      })
    : cleaned

  if (invalidPts.size > 0) {
    console.log(`[WebRTC] [SDP] Stripped invalid payload types: ${[...invalidPts].join(', ')}`)
  }

  // Pass 3: ensure video codecs have proper fmtp and rtcp-fb attributes.
  // GStreamer webrtcbin often omits H264 profile-level-id and NACK feedback,
  // which prevents mobile browsers from initializing the decoder.
  const final: string[] = []
  for (let i = 0; i < out.length; i++) {
    final.push(out[i])
    const rtpmapMatch = out[i].match(/^a=rtpmap:(\d+) (H264|VP8|VP9)\//)
    if (rtpmapMatch) {
      const pt = rtpmapMatch[1]
      const codec = rtpmapMatch[2]
      // H264 requires fmtp with profile-level-id for the browser to init the decoder
      if (codec === 'H264' && !out.some(l => l.startsWith(`a=fmtp:${pt} `))) {
        final.push(`a=fmtp:${pt} packetization-mode=1;profile-level-id=42001f;level-asymmetry-allowed=1`)
        console.log(`[WebRTC] [SDP] Added missing H264 fmtp for pt=${pt}`)
      }
      // NACK + PLI feedback enables packet loss recovery and keyframe requests
      if (!out.some(l => l === `a=rtcp-fb:${pt} nack` || l.startsWith(`a=rtcp-fb:${pt} nack\r`))) {
        final.push(`a=rtcp-fb:${pt} nack`)
        final.push(`a=rtcp-fb:${pt} nack pli`)
        console.log(`[WebRTC] [SDP] Added NACK/PLI feedback for pt=${pt}`)
      }
    }
  }

  let result = final.join('\r\n')
  if (!result.endsWith('\r\n')) result += '\r\n'
  return result
}
