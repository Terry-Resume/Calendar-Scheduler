import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { signState } from '@/lib/oauth-state'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientId = process.env.GOOGLE_CLIENT_ID
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!clientId || !appUrl) {
    return NextResponse.json({ error: 'Google OAuth not configured' }, { status: 503 })
  }

  const stateSecret = process.env.OAUTH_STATE_SECRET ?? process.env.CLERK_SECRET_KEY
  if (!stateSecret) return NextResponse.json({ error: 'OAuth state secret is not configured' }, { status: 503 })

  const redirectUri = `${appUrl}/api/auth/google/callback`
  const scope = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
  ].join(' ')

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', scope)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', signState(userId, stateSecret))

  return NextResponse.redirect(url.toString())
}

