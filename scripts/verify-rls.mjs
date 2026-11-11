#!/usr/bin/env node
// Proves the database is closed to the public anon key.
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/verify-rls.mjs
// Exit code 1 if any table returns rows (or accepts a request) for the anon key.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/** 'locked' = denied or empty; 'exposed' = anon key got rows. */
export function classify(status, body) {
  if (status === 401 || status === 403) return 'locked'
  if (status >= 200 && status < 300) return Array.isArray(body) && body.length === 0 ? 'locked' : 'exposed'
  return 'locked' // 404/42501 etc: the table is not reachable
}

export function tablesFromMigrations(dir) {
  const names = new Set()
  for (const f of readdirSync(dir).filter(f => f.endsWith('.sql'))) {
    for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/CREATE TABLE IF NOT EXISTS\s+(?:public\.)?(\w+)/gi)) names.add(m[1])
  }
  return [...names].sort()
}

async function main() {
  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY
  if (!url || !anon) { console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY'); process.exit(2) }
  const dir = join(fileURLToPath(new URL('..', import.meta.url)), 'supabase', 'migrations')
  let exposed = 0
  for (const table of tablesFromMigrations(dir)) {
    const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } })
    const body = await res.json().catch(() => null)
    const verdict = classify(res.status, body)
    if (verdict === 'exposed') exposed++
    console.log(`${verdict === 'locked' ? 'ok     ' : 'EXPOSED'} ${table} (${res.status})`)
  }
  if (exposed) { console.error(`\n${exposed} table(s) readable with the anon key. Apply migration 016.`); process.exit(1) }
  console.log('\nAll tables are closed to the anon key.')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
