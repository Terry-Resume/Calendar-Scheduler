import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase'
import { verifyState } from '@/lib/oauth-state'

// Google redirects here after consent. We only store tokens when the signed `state`
// proves this exact signed-in user started the flow.
export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin
  const back = (result: string) => NextResponse.redirect(new URL(`/dashboard/calendar?google=${result}`, appUrl))

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const stateSecret = process.env.OAUTH_STATE_SECRET ?? process.env.CLERK_SECRET_KEY
  if (!clientId || !clientSecret || !stateSecret) {
    return NextResponse.json({ error: 'Google OAuth not configured' }, { status: 503 })
  }

  const params = req.nextUrl.searchParams
  if (params.get('error')) return back('denied')

  if (verifyState(params.get('state'), stateSecret) !== userId) {
    return NextResponse.json({ error: 'Invalid or expired state' }, { status: 400 })
  }
  const code = params.get('code')
  if (!code) return NextResponse.json({ error: 'Missing code' }, { status: 400 })

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${appUrl}/api/auth/google/callback`,
      grant_type: 'authorization_code',
    }),
  })
  if (!tokenRes.ok) return back('error')
  const tokens = (await tokenRes.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }
  if (!tokens.access_token) return back('error')

  const { error } = await createClient()
    .from('profiles')
    .upsert(
      {
        user_id: userId,
        google_access_token: tokens.access_token,
        google_token_expiry: Date.now() + (tokens.expires_in ?? 3600) * 1000,
        // Google only returns a refresh token on first consent; never overwrite it with nothing.
        ...(tokens.refresh_token ? { google_refresh_token: tokens.refresh_token } : {}),
      },
      { onConflict: 'user_id' },
    )
  if (error) return back('error')

  return back('connected')
}
