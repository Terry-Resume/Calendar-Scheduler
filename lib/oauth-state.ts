import { createHmac, timingSafeEqual } from 'node:crypto'

const TTL_MS = 10 * 60 * 1000

const b64 = (s: string) => Buffer.from(s).toString('base64url')
const mac = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('base64url')

/**
 * OAuth `state` that binds the Google consent flow to one signed-in user and expires.
 * (The flow used to send the raw user id, which anyone could forge.)
 */
export function signState(userId: string, secret: string, now = Date.now()): string {
  const payload = b64(JSON.stringify({ u: userId, e: now + TTL_MS }))
  return `${payload}.${mac(payload, secret)}`
}

/** Returns the user id the state was issued for, or null if it is forged, malformed or expired. */
export function verifyState(state: string | null, secret: string, now = Date.now()): string | null {
  if (!state) return null
  const [payload, sig, extra] = state.split('.')
  if (!payload || !sig || extra !== undefined) return null
  const expected = Buffer.from(mac(payload, secret))
  const given = Buffer.from(sig)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const { u, e } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { u?: unknown; e?: unknown }
    return typeof u === 'string' && typeof e === 'number' && e > now ? u : null
  } catch {
    return null
  }
}
