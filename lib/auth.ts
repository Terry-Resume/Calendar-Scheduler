/**
 * Admin access is granted by Clerk user id, listed in ADMIN_USER_IDS (comma-separated).
 * There is deliberately no built-in default: privilege should not live in source control.
 */
export function parseAdminIds(value: string | undefined): Set<string> {
  return new Set((value ?? '').split(',').map(s => s.trim()).filter(Boolean))
}

export function isAdminUser(userId: string, env: Record<string, string | undefined> = process.env): boolean {
  return parseAdminIds(env.ADMIN_USER_IDS).has(userId)
}
