import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { isAdminUser, parseAdminIds } from '../lib/auth.ts'
import { verifyCronAuth } from '../lib/cron-auth.ts'
import { classify, tablesFromMigrations } from '../scripts/verify-rls.mjs'

test('admin ids come only from ADMIN_USER_IDS (no built-in default)', () => {
  assert.equal(isAdminUser('user_1', {}), false)
  assert.equal(isAdminUser('user_1', { ADMIN_USER_IDS: ' user_1 , user_2,, ' }), true)
  assert.equal(isAdminUser('user_3', { ADMIN_USER_IDS: 'user_1,user_2' }), false)
  assert.deepEqual([...parseAdminIds(undefined)], [])
})

test('cron auth fails closed when CRON_SECRET is not configured', () => {
  assert.equal(verifyCronAuth('Bearer anything', undefined), 'unconfigured')
  assert.equal(verifyCronAuth(null, ''), 'unconfigured')
})

test('cron auth accepts only the exact bearer secret', () => {
  assert.equal(verifyCronAuth('Bearer s3cret', 's3cret'), 'ok')
  for (const bad of [null, '', 'Bearer', 'Bearer s3cre', 'Bearer s3cret ', 'bearer s3cret', 's3cret']) {
    assert.equal(verifyCronAuth(bad, 's3cret'), 'unauthorized', String(bad))
  }
})

test('rls verifier: rows for the anon key mean exposed, denial or empty means locked', () => {
  assert.equal(classify(401, { message: 'permission denied' }), 'locked')
  assert.equal(classify(200, []), 'locked')
  assert.equal(classify(200, [{ user_id: 'x' }]), 'exposed')
})

test('every table created by a migration is covered by the lockdown (it loops over all public tables)', () => {
  const tables = tablesFromMigrations(new URL('../supabase/migrations', import.meta.url).pathname)
  assert.ok(tables.includes('profiles') && tables.includes('tasks'))
  const sql = readFileSync(new URL('../supabase/migrations/016_lock_down_database.sql', import.meta.url), 'utf8')
  assert.match(sql, /FROM pg_tables WHERE schemaname = 'public'/)
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE ALL ON TABLE public\.%I FROM anon, authenticated/)
})

test('the browser never receives a database key', () => {
  const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (['node_modules', '.next', '.git'].includes(e.name) ? [] : walk(`${d}/${e.name}`)) : [`${d}/${e.name}`])
  const root = new URL('..', import.meta.url).pathname
  const offenders = walk(root).filter(f => /\.(ts|tsx|mjs|js|example)$/.test(f) && !f.includes('/test/'))
    .filter(f => /NEXT_PUBLIC_SUPABASE_(ANON|SERVICE)/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(offenders, [])
})

import { signState, verifyState } from '../lib/oauth-state.ts'

test('oauth state round-trips for the issuing user only', () => {
  const s = signState('user_1', 'secret', 1_000)
  assert.equal(verifyState(s, 'secret', 2_000), 'user_1')
  assert.equal(verifyState(s, 'other-secret', 2_000), null, 'wrong secret')
})

test('oauth state rejects forgery, tampering, expiry and the old raw-user-id format', () => {
  const s = signState('user_1', 'secret', 1_000)
  assert.equal(verifyState('user_1', 'secret', 2_000), null, 'raw user id (the previous format) is not accepted')
  assert.equal(verifyState(null, 'secret'), null)
  assert.equal(verifyState(s + 'x', 'secret', 2_000), null)
  const [payload] = s.split('.')
  const forged = Buffer.from(JSON.stringify({ u: 'user_2', e: 9e15 })).toString('base64url')
  assert.equal(verifyState(`${forged}.${s.split('.')[1]}`, 'secret', 2_000), null, 'payload swapped, signature reused')
  assert.equal(verifyState(`${payload}.${s.split('.')[1]}.extra`, 'secret', 2_000), null)
  assert.equal(verifyState(s, 'secret', 1_000 + 11 * 60 * 1000), null, 'expired after 10 minutes')
})
