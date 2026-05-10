// Phase 18 sub-I-2 happy-path e2e.
//
// Smoke test that proves the dashboard's team flow renders correctly
// against a live server. We deliberately keep the API doing the heavy
// data-shaping (register / verify / org create / team create / invite)
// because that's already exhaustively covered by the rust integration
// tests. The browser side proves: login works, the teams page lists
// real DB rows, and the invite flow lands an invitee on the org page.
//
// Couples to the local dev container layout (sentori-pg on
// 127.0.0.1:55434) via the verify-token helper. CI will get a proper
// dev-only `/dev/last-verify-token` endpoint when this moves out of
// "run locally" mode.

import { execFileSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

const PASSWORD = 'pw-e2e-teams-1234'

function uniq(): string {
  const buf = new Uint8Array(6)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

function fetchVerifyToken(email: string): string {
  const stdout = execFileSync('docker', [
    'exec',
    'sentori-pg',
    'psql',
    '-U',
    'postgres',
    '-d',
    'sentori',
    '-tA',
    '-c',
    `SELECT ev.token FROM email_verifications ev JOIN users u ON u.id = ev.user_id WHERE u.email = '${email}' ORDER BY ev.created_at DESC LIMIT 1`,
  ])
  const token = stdout.toString().trim()
  if (!token) throw new Error(`no verify token for ${email}`)
  return token
}

async function registerAndVerify(
  request: import('@playwright/test').APIRequestContext,
  email: string,
): Promise<void> {
  const reg = await request.post('/api/auth/register', {
    data: { email, password: PASSWORD },
  })
  expect(reg.ok(), 'register').toBeTruthy()
  const token = fetchVerifyToken(email)
  const ver = await request.get(`/api/auth/verify?token=${encodeURIComponent(token)}`)
  expect(ver.ok(), 'verify').toBeTruthy()
}

test('owner creates team, invitee accepts pre-bound invite', async ({
  browser,
  request,
}) => {
  const ownerEmail = `e2e-owner-${uniq()}@golia.test`
  const inviteeEmail = `e2e-invitee-${uniq()}@golia.test`
  const orgSlug = `e2e-${uniq()}`

  // Pre-stage both accounts via API (verified, ready to log in).
  await registerAndVerify(request, ownerEmail)
  await registerAndVerify(request, inviteeEmail)

  // ── Owner UI session ──────────────────────────────────────────────
  const ownerCtx = await browser.newContext()
  const ownerPage = await ownerCtx.newPage()
  await ownerPage.goto('/login')
  await ownerPage.getByPlaceholder('you@example.com').fill(ownerEmail)
  await ownerPage.getByPlaceholder('Password').fill(PASSWORD)
  await ownerPage.getByRole('button', { name: /sign in/i }).click()
  // Brand-new account → redirects to onboarding to create the first org.
  await ownerPage.waitForURL(/\/onboarding/)

  // Use the owner's page-bound request context so cookies are shared.
  const ownerApi = ownerPage.request

  // Create the org via API (the onboarding form is exercised in unit
  // tests; e2e proves the post-create dashboard works).
  const orgResp = await ownerApi.post('/api/orgs', {
    data: { name: orgSlug, slug: orgSlug },
  })
  expect(orgResp.status(), 'org create').toBe(201)

  // Create alpha team via API.
  const teamResp = await ownerApi.post(`/api/orgs/${orgSlug}/teams`, {
    data: { name: 'Alpha', slug: 'alpha' },
  })
  expect(teamResp.status(), 'team create').toBe(201)

  // Owner UI: navigate to teams page; alpha must render.
  await ownerPage.goto(`/org/${orgSlug}/teams`)
  await expect(ownerPage.getByRole('link', { name: 'alpha' })).toBeVisible()

  // Issue an invite pre-bound to alpha.
  const invResp = await ownerApi.post(`/api/orgs/${orgSlug}/invites`, {
    data: { email: inviteeEmail, role: 'member', teamSlug: 'alpha' },
  })
  expect(invResp.status(), 'invite create').toBe(201)
  const { token: inviteToken } = (await invResp.json()) as { token: string }

  // listInvites must surface the team binding (sub-F).
  const listResp = await ownerApi.get(`/api/orgs/${orgSlug}/invites`)
  const list = (await listResp.json()) as Array<{
    teamSlug: null | string
    token: string
  }>
  expect(list.find((i) => i.token === inviteToken)?.teamSlug).toBe('alpha')

  // ── Invitee UI session ────────────────────────────────────────────
  const invCtx = await browser.newContext()
  const invPage = await invCtx.newPage()
  await invPage.goto('/login')
  await invPage.getByPlaceholder('you@example.com').fill(inviteeEmail)
  await invPage.getByPlaceholder('Password').fill(PASSWORD)
  await invPage.getByRole('button', { name: /sign in/i }).click()
  // No org yet → onboarding. Then jump straight to the invite link.
  await invPage.waitForURL(/\/onboarding/)
  await invPage.goto(`/invite/${inviteToken}`)
  // The invite-accept view fires the POST automatically on mount and
  // navigates to /org/<slug>/issues on success.
  await invPage.waitForURL(new RegExp(`/org/${orgSlug}`), { timeout: 10_000 })

  // Verify the invitee is in the team via API (cheap & deterministic).
  const inviteeApi = invPage.request
  const myTeamsResp = await inviteeApi.get(
    `/api/orgs/${orgSlug}/teams/alpha/members`,
  )
  expect(myTeamsResp.status()).toBe(200)
  const members = (await myTeamsResp.json()) as Array<{ email: string }>
  expect(members.some((m) => m.email === inviteeEmail)).toBeTruthy()

  await ownerCtx.close()
  await invCtx.close()
})
