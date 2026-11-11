import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase'
import { verifyCronAuth } from '@/lib/cron-auth'

// Triggered every 15 minutes by .github/workflows/meeting-alerts.yml (or Vercel Cron on a Pro plan).
// Checks for meetings starting in ~10 min and ~30 min, sends Discord alerts.
// Secured via CRON_SECRET env var.

interface Meeting {
  id: string
  title: string
  description: string | null
  date: string
  start_hour: number
  start_minute: number
  end_hour: number | null
  end_minute: number
  organizer_id: string
}

interface Invite {
  meeting_id: string
  user_id: string
  display_name: string | null
}

interface Profile {
  user_id: string
  display_name: string | null
  discord_username: string | null
  discord_user_id: string | null
}

function pad(n: number) { return String(n).padStart(2, '0') }

function fmtTime(h: number, m: number) {
  const ap = h < 12 ? 'AM' : 'PM'
  const hh = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${hh}:${pad(m)} ${ap}`
}

function discordMention(profile: Profile | undefined): string {
  if (!profile) return 'Unknown'
  if (profile.discord_user_id) return `<@${profile.discord_user_id}>`
  if (profile.discord_username) return `@${profile.discord_username}`
  return profile.display_name ?? 'Unknown'
}

function hexToDecimal(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}

async function sendDiscordAlert(
  webhookUrl: string,
  meeting: Meeting,
  invites: Invite[],
  profiles: Profile[],
  minutesUntil: number
) {
  const profileMap = Object.fromEntries(profiles.map(p => [p.user_id, p]))

  const organizerProfile = profileMap[meeting.organizer_id]
  const attendeeProfiles = invites.map(i => profileMap[i.user_id]).filter(Boolean) as Profile[]

  const timeStr = fmtTime(meeting.start_hour, meeting.start_minute)
  const endStr = meeting.end_hour != null ? ` – ${fmtTime(meeting.end_hour, meeting.end_minute)}` : ''

  // Build @mention line for direct pings
  const mentions = [
    organizerProfile ? discordMention(organizerProfile) : null,
    ...attendeeProfiles.map(p => discordMention(p)),
  ].filter(Boolean).join(' ')

  const attendeeNames = [
    organizerProfile?.display_name ?? 'Organizer',
    ...invites.map(i => profileMap[i.user_id]?.display_name ?? i.display_name ?? 'Member'),
  ].join(', ')

  const urgency = minutesUntil <= 10 ? '🔴' : '🟡'
  const urgencyLabel = minutesUntil <= 10 ? `Starting in ${minutesUntil} minutes!` : `Starting in ${minutesUntil} minutes`

  const payload = {
    content: mentions ? `${urgency} Meeting alert for ${mentions}` : `${urgency} Meeting alert`,
    embeds: [
      {
        title: `📅 ${meeting.title}`,
        description: meeting.description ? `> ${meeting.description}` : undefined,
        color: minutesUntil <= 10 ? hexToDecimal('#ef4444') : hexToDecimal('#e85d7b'),
        fields: [
          {
            name: '⏰ Time',
            value: `${timeStr}${endStr}`,
            inline: true,
          },
          {
            name: '⚡ Status',
            value: urgencyLabel,
            inline: true,
          },
          {
            name: '👥 Attendees',
            value: attendeeNames || 'No attendees listed',
            inline: false,
          },
        ],
        footer: {
          text: 'Kato.8 Studios · Team Scheduler',
        },
        timestamp: new Date().toISOString(),
      },
    ],
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Discord webhook failed: ${res.status} ${text}`)
  }
}

export async function GET(req: NextRequest) {
  // Verify cron secret (fails closed when CRON_SECRET is not configured)
  const cronAuth = verifyCronAuth(req.headers.get('authorization'), process.env.CRON_SECRET)
  if (cronAuth === 'unconfigured') {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 })
  }
  if (cronAuth !== 'ok') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL
  if (!webhookUrl) {
    return NextResponse.json({ error: 'DISCORD_WEBHOOK_URL not configured' }, { status: 503 })
  }

  try {
    const supabase = createClient()
    const now = new Date()
    const todayStr = now.toISOString().split('T')[0] // YYYY-MM-DD

    // Fetch all meetings for today that have a start time
    const { data: meetings, error } = await supabase
      .from('meetings')
      .select('id, title, description, date, start_hour, start_minute, end_hour, end_minute, organizer_id')
      .eq('date', todayStr)
      .not('start_hour', 'is', null)

    if (error) {
      console.error('Cron fetch error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!meetings || meetings.length === 0) {
      return NextResponse.json({ sent: 0, message: 'No meetings today' })
    }

    // Figure out which meetings need alerts (10min or 30min window)
    const alertWindows = [
      { type: '30min', targetMinutes: 30, toleranceMinutes: 8 },
      { type: '10min', targetMinutes: 10, toleranceMinutes: 6 },
    ]

    const alertsToSend: { meeting: Meeting; alertType: string; minutesUntil: number }[] = []

    for (const meeting of meetings as Meeting[]) {
      const meetingTime = new Date(
        `${meeting.date}T${pad(meeting.start_hour)}:${pad(meeting.start_minute)}:00`
      )
      const diffMs = meetingTime.getTime() - now.getTime()
      const diffMin = Math.round(diffMs / 60000)

      for (const window of alertWindows) {
        if (
          diffMin >= window.targetMinutes - window.toleranceMinutes &&
          diffMin <= window.targetMinutes + window.toleranceMinutes
        ) {
          alertsToSend.push({ meeting, alertType: window.type, minutesUntil: diffMin })
        }
      }
    }

    if (alertsToSend.length === 0) {
      return NextResponse.json({ sent: 0, message: 'No alerts due right now' })
    }

    // Filter out already-sent alerts
    const potentialIds = [...new Set(alertsToSend.map(a => a.meeting.id))]

    const { data: alreadySent } = await supabase
      .from('meeting_alert_logs')
      .select('meeting_id, alert_type')
      .in('meeting_id', potentialIds)

    const sentSet = new Set(
      (alreadySent ?? []).map(r => `${r.meeting_id}:${r.alert_type}`)
    )

    const pending = alertsToSend.filter(
      a => !sentSet.has(`${a.meeting.id}:${a.alertType}`)
    )

    if (pending.length === 0) {
      return NextResponse.json({ sent: 0, message: 'All alerts already sent' })
    }

    // Fetch invites first, then profiles (profiles need invite user IDs)
    const meetingIds = [...new Set(pending.map(a => a.meeting.id))]
    const organizerIds = [...new Set(pending.map(a => a.meeting.organizer_id))]

    const { data: invites } = await supabase
      .from('meeting_invites')
      .select('meeting_id, user_id, display_name')
      .in('meeting_id', meetingIds)

    const allUserIds = [...new Set([
      ...organizerIds,
      ...(invites ?? []).map((i: { user_id: string }) => i.user_id),
    ])]

    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, display_name, discord_username, discord_user_id')
      .in('user_id', allUserIds)

    // Send alerts
    let sentCount = 0
    const logEntries: { meeting_id: string; alert_type: string }[] = []

    for (const alert of pending) {
      const meetingInvites = (invites ?? []).filter(
        (i: { meeting_id: string }) => i.meeting_id === alert.meeting.id
      ) as Invite[]

      try {
        await sendDiscordAlert(
          webhookUrl,
          alert.meeting,
          meetingInvites,
          (profiles ?? []) as Profile[],
          alert.minutesUntil
        )
        logEntries.push({ meeting_id: alert.meeting.id, alert_type: alert.alertType })
        sentCount++
      } catch (err) {
        console.error(`Failed to send alert for meeting ${alert.meeting.id}:`, err)
      }
    }

    // Log sent alerts (ignore conflicts — already filtered above)
    if (logEntries.length > 0) {
      await supabase
        .from('meeting_alert_logs')
        .upsert(logEntries, { onConflict: 'meeting_id,alert_type', ignoreDuplicates: true })
    }

    return NextResponse.json({
      sent: sentCount,
      checked: alertsToSend.length,
      skippedAlreadySent: alertsToSend.length - pending.length,
    })
  } catch (err) {
    console.error('Cron error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

