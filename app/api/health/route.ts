import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Uptime probe for the Central Command hub. Public, and reports only booleans.
export async function GET() {
  const checks: Record<string, boolean> = {
    clerk: Boolean(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
    database_config: Boolean((process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY),
  }
  if (checks.database_config) {
    try {
      const { error } = await createClient().from('projects').select('id', { head: true, count: 'exact' }).limit(1)
      checks.database = !error
    } catch {
      checks.database = false
    }
  }
  const failing = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)
  return NextResponse.json(
    { ok: failing.length === 0, service: 'scheduler', checks, failing, time: new Date().toISOString() },
    { status: failing.length ? 503 : 200, headers: { 'cache-control': 'no-store' } },
  )
}
