import { timingSafeEqual } from 'node:crypto'

/**
 * Checks the `Authorization: Bearer <CRON_SECRET>` header on cron endpoints.
 * Fails closed: when CRON_SECRET is not configured nobody is let in. (The previous
 * check only compared when the secret existed, which left the endpoint open.)
 */
export function verifyCronAuth(authorization: string | null, secret: string | undefined): 'ok' | 'unconfigured' | 'unauthorized' {
  if (!secret) return 'unconfigured'
  const expected = Buffer.from(`Bearer ${secret}`)
  const given = Buffer.from(authorization ?? '')
  return given.length === expected.length && timingSafeEqual(given, expected) ? 'ok' : 'unauthorized'
}
