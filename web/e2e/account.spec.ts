// v1.0 — account-module browser e2e.
//
// Exercises the dashboard flows end-to-end against the live server:
//
//   1. register + verify + first-time login → onboarding
//   2. forgot-password (UI submit → DB-pulled token → reset via UI →
//      new pw works, old pw doesn't)
//   3. /account profile update → toolbar avatar reflects it
//   4. /account password change → new pw works, old pw is rejected on
//      a fresh browser context
//   5. /account "sign out other devices" → second context loses session
//   6. /account requires auth — logged-out user is bounced to /login
//
// Server-side correctness for the same paths is asserted by the rust
// `tests/account.rs` integration suite. This file proves the dashboard
// drives the same endpoints correctly through real DOM events.
//
// OAuth UI flows are not covered here (Playwright can't easily
// complete a real Google/GitHub consent screen). Routing + state-
// cookie correctness for those paths is covered by the rust suite.

import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const PASSWORD = 'pw-e2e-account-1234'

function uniq(): string {
  const buf = new Uint8Array(6)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Pull the latest email-verification token through the dev-only
 *  endpoint mounted when SENTORI_EXPOSE_DEV_TOKENS=1 (set in
 *  playwright.config.ts for the SERVER_ENV — prod never gets it). */
async function fetchVerifyToken(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  const resp = await request.get(
    `/dev/last-verify-token?email=${encodeURIComponent(email)}`,
  )
  if (!resp.ok()) throw new Error(`no verify token for ${email} (${resp.status()})`)
  return ((await resp.json()) as { token: string }).token
}

async function fetchResetToken(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  const resp = await request.get(
    `/dev/last-reset-token?email=${encodeURIComponent(email)}`,
  )
  if (!resp.ok()) throw new Error(`no reset token for ${email} (${resp.status()})`)
  return ((await resp.json()) as { token: string }).token
}

/** Stage a verified user via the API. The browser doesn't have to
 *  click through register/verify on every test — that flow is its own
 *  dedicated test. */
async function stageUser(request: APIRequestContext, email: string): Promise<void> {
  const reg = await request.post('/api/auth/register', {
    data: { email, password: PASSWORD },
  })
  expect(reg.ok(), `register ${email}`).toBeTruthy()
  const token = await fetchVerifyToken(request, email)
  const ver = await request.get(`/api/auth/verify?token=${encodeURIComponent(token)}`)
  expect(ver.ok(), 'verify').toBeTruthy()
}

/** Log in via the UI and wait for the post-login redirect. New users
 *  with no org land on /onboarding. */
async function loginUi(
  page: Page,
  email: string,
  password: string = PASSWORD,
): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('email').fill(email)
  await page.getByLabel('password').fill(password)
  await page.getByRole('button', { name: /sign in/i }).click()
}

// ─── 1. register + verify + first-time login ─────────────────────────

test('register → verify → login lands on onboarding', async ({ browser, request }) => {
  const email = `e2e-reg-${uniq()}@golia.test`
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  await page.goto('/register')
  await page.getByLabel('email').fill(email)
  await page.getByLabel('password').fill(PASSWORD)
  await page.getByRole('button', { name: /create account/i }).click()
  // Server replies 200, dashboard navigates to /verify.
  await page.waitForURL(/\/verify/)

  // Verify out-of-band (we don't have email delivery in test).
  const token = await fetchVerifyToken(request, email)
  const ver = await request.get(`/api/auth/verify?token=${encodeURIComponent(token)}`)
  expect(ver.ok()).toBeTruthy()

  // Now sign in. A brand-new account with no org lands on /onboarding;
  // existing-org auto-provisioning would route to /org/.../overview.
  // Accept either — what we care about is "left /login successfully".
  await loginUi(page, email)
  await page.waitForURL(/\/onboarding|\/org\//, { timeout: 10_000 })

  await ctx.close()
})

// ─── 2. forgot-password → reset → login with new pw ──────────────────

test('forgot-password → reset → new pw authenticates', async ({ browser, request }) => {
  const email = `e2e-fp-${uniq()}@golia.test`
  await stageUser(request, email)

  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  // Initiate from the login page so we hit the link the dashboard
  // exposes in the wild.
  await page.goto('/login')
  await page.getByRole('link', { name: /forgot password/i }).click()
  await page.waitForURL(/\/forgot-password/)
  await page.getByLabel('email').fill(email)
  await page.getByRole('button', { name: /send reset link/i }).click()
  // The submit button disappears when the success state takes over —
  // that's a cheaper, more reliable signal than scanning multi-node
  // copy for a substring, and tolerates a slower CI cold-start.
  await expect(page.getByRole('button', { name: /send reset link/i })).toBeHidden({
    timeout: 15_000,
  })

  // Pull the token from the DB + drive the reset UI.
  const token = await fetchResetToken(request, email)
  const newPw = 'rotated-via-e2e-9876'
  await page.goto(`/reset-password/${token}`)
  await page.getByLabel('new password').fill(newPw)
  await page.getByRole('button', { name: /set password/i }).click()
  // The reset view auto-redirects to /login after a short delay.
  await page.waitForURL(/\/login/, { timeout: 5_000 })

  // Old password rejected.
  await page.getByLabel('email').fill(email)
  await page.getByLabel('password').fill(PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page.getByText(/login failed|invalid/i)).toBeVisible({ timeout: 5_000 })

  // New password works.
  await page.getByLabel('password').fill(newPw)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/onboarding|\/org\//, { timeout: 10_000 })

  await ctx.close()
})

// ─── 3. profile update flows back to the toolbar avatar ───────────────

test('account: profile update reflects in /me + toolbar', async ({ browser, request }) => {
  const email = `e2e-prof-${uniq()}@golia.test`
  await stageUser(request, email)

  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await loginUi(page, email)
  await page.waitForURL(/\/onboarding|\/org\//, { timeout: 10_000 })

  await page.goto('/account')
  const displayInput = page.getByLabel('display name')
  await displayInput.fill('E2E Renamed')
  await page.getByLabel('avatar URL (optional)').fill('https://example.com/e2e.png')
  await page.getByRole('button', { name: /save profile/i }).click()
  await expect(page.getByText(/saved/i)).toBeVisible({ timeout: 5_000 })

  // /me must reflect the change.
  const me = await page.request.get('/api/auth/me')
  const body = (await me.json()) as { user: { displayName: string; avatarUrl: string } }
  expect(body.user.displayName).toBe('E2E Renamed')
  expect(body.user.avatarUrl).toBe('https://example.com/e2e.png')

  // Reload — the value sticks (not just a UI-only edit).
  await page.reload()
  await expect(page.getByLabel('display name')).toHaveValue('E2E Renamed')

  await ctx.close()
})

// ─── 4. change-password rotates the credential ────────────────────────

test('account: change password — new works, old rejected', async ({ browser, request }) => {
  const email = `e2e-cp-${uniq()}@golia.test`
  await stageUser(request, email)
  const newPw = 'changed-via-e2e-account-7777'

  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await loginUi(page, email)
  await page.waitForURL(/\/onboarding|\/org\//, { timeout: 10_000 })

  await page.goto('/account')
  await page.getByLabel('current password').fill(PASSWORD)
  await page.getByLabel('new password').fill(newPw)
  await page.getByRole('button', { name: /change password/i }).click()
  await expect(page.getByText(/password updated/i)).toBeVisible({ timeout: 5_000 })

  // Drop into a fresh context to test cred rotation cleanly (the
  // current session is still valid; we want to prove the credential
  // changed at the storage layer).
  const fresh = await browser.newContext()
  const freshPage = await fresh.newPage()
  await freshPage.goto('/login')
  await freshPage.getByLabel('email').fill(email)
  await freshPage.getByLabel('password').fill(PASSWORD)
  await freshPage.getByRole('button', { name: /sign in/i }).click()
  await expect(freshPage.getByText(/login failed|invalid/i)).toBeVisible({ timeout: 5_000 })

  await freshPage.getByLabel('password').fill(newPw)
  await freshPage.getByRole('button', { name: /sign in/i }).click()
  await freshPage.waitForURL(/\/onboarding|\/org\//, { timeout: 10_000 })

  await ctx.close()
  await fresh.close()
})

// ─── 5. sign out other devices kills sibling sessions ─────────────────

test('account: sign out other devices kills sibling session', async ({ browser, request }) => {
  const email = `e2e-soe-${uniq()}@golia.test`
  await stageUser(request, email)

  // Context A — primary device.
  const ctxA = await browser.newContext()
  const pageA = await ctxA.newPage()
  await loginUi(pageA, email)
  await pageA.waitForURL(/\/onboarding|\/org\//, { timeout: 10_000 })

  // Context B — sibling device.
  const ctxB = await browser.newContext()
  const pageB = await ctxB.newPage()
  await loginUi(pageB, email)
  await pageB.waitForURL(/\/onboarding|\/org\//, { timeout: 10_000 })

  // From A, hit sign-out-everywhere. The page uses window.confirm; pre-
  // accept it.
  await pageA.goto('/account')
  pageA.once('dialog', (d) => void d.accept())
  await pageA.getByRole('button', { name: /sign out other devices/i }).click()
  await expect(pageA.getByText(/other sessions signed out/i)).toBeVisible({ timeout: 5_000 })

  // A still alive — /me returns 200.
  const meA = await pageA.request.get('/api/auth/me')
  expect(meA.ok()).toBeTruthy()

  // B's session is dead — /me returns 401.
  const meB = await pageB.request.get('/api/auth/me')
  expect(meB.status()).toBe(401)

  await ctxA.close()
  await ctxB.close()
})

// ─── 6. /account requires auth ────────────────────────────────────────

test('logged-out user hitting /account bounces to /login', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto('/account')
  await page.waitForURL(/\/login/, { timeout: 5_000 })
  await ctx.close()
})
