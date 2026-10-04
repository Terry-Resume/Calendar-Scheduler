import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import type { NextFetchEvent } from 'next/server'

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
])

const clerkHandler = clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    // Send signed-out visitors to this app's own sign-in page (the Vercel
    // NEXT_PUBLIC_CLERK_SIGN_IN_URL points at an old development instance).
    await auth.protect({ unauthenticatedUrl: new URL('/sign-in', request.url).toString() })
  }
})

export async function middleware(req: NextRequest, evt: NextFetchEvent) {
  try {
    return await clerkHandler(req, evt)
  } catch (error) {
    console.error('[middleware] Clerk error:', error)
    if (!isPublicRoute(req)) {
      return NextResponse.redirect(new URL('/sign-in', req.url))
    }
    return NextResponse.next()
  }
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
