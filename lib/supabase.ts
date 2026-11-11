import 'server-only'
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

/**
 * Supabase client for server code (route handlers and server components).
 *
 * Uses the service-role key, which bypasses row-level security. That is the point:
 * every table is locked down to anon/authenticated roles (migration 016) and all
 * access goes through this app's own Clerk-checked API routes. The key must never
 * carry a NEXT_PUBLIC_ prefix, and `server-only` makes the build fail if a client
 * component ever imports this file.
 */
export function createClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error('Missing Supabase env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (server-side only).')
  }

  cached ??= createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return cached
}
