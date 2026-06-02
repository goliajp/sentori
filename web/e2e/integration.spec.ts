// v1.0 — project integration / token management e2e.
//
// Drives the full "I created a project, how do I send events to it"
// loop through the dashboard:
//
//   1. Stage a verified user, log in via UI, create an org + project
//      through the API (the org/project create UI is exercised
//      elsewhere).
//   2. Navigate to /org/{slug}/projects/{id}/integration via the
//      Settings → Projects "integrate →" link.
//   3. Mint a token through the UI, assert the secret reveal block
//      shows the freshly minted secret.
//   4. The token row appears in the active list with the expected
//      label + last4.
//   5. Quickstart snippet substitutes the secret.
//   6. Revoke flow drops the token from the active list.

import { expect, test, type APIRequestContext } from '@playwright/test'

const PASSWORD = 'pw-e2e-int-1234'

function uniq(): string {
  const buf = new Uint8Array(6)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function fetchVerifyToken(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  const resp = await request.get(
    `/dev/last-verify-token?email=${encodeURIComponent(email)}`,
  )
  if (!resp.ok()) throw new Error(`no verify token for ${email}`)
  return ((await resp.json()) as { token: string }).token
}

async function stageUser(request: APIRequestContext, email: string): Promise<void> {
  const reg = await request.post('/api/auth/register', {
    data: { email, password: PASSWORD },
  })
  expect(reg.ok()).toBeTruthy()
  const token = await fetchVerifyToken(request, email)
  const ver = await request.get(`/api/auth/verify?token=${encodeURIComponent(token)}`)
  expect(ver.ok()).toBeTruthy()
}

test('mint → list → revoke project ingest token via UI', async ({ browser, request }) => {
  const email = `e2e-int-${uniq()}@golia.test`
  const orgSlug = `e2e-int-${uniq()}`
  const projName = `proj-${uniq()}`

  await stageUser(request, email)

  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  // Log in via UI.
  await page.goto('/login')
  await page.getByLabel('email').fill(email)
  await page.getByLabel('password').fill(PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/onboarding|\/org\//, { timeout: 10_000 })

  // Create the org + project through the API on the page's cookie jar.
  // (The org/project create flow has its own UI tests; this one
  // focuses on the integration view.)
  const orgResp = await page.request.post('/api/orgs', {
    data: { name: orgSlug, slug: orgSlug },
  })
  expect(orgResp.status()).toBe(201)
  const projResp = await page.request.post(`/admin/api/orgs/${orgSlug}/projects`, {
    data: { name: projName },
  })
  expect(projResp.status(), `project create ${await projResp.text()}`).toBeLessThan(300)
  const { id: projectId } = (await projResp.json()) as { id: string }

  // Jump straight to the integration module with the project pinned.
  await page.goto(`/org/${orgSlug}/integrate?project=${projectId}`)

  // Empty state.
  await expect(page.getByText(/no active tokens yet/i)).toBeVisible()

  // Mint a token through the UI.
  await page.getByLabel(/label/i).fill('insight-prod')
  await page.getByRole('button', { name: /\+ mint token/i }).click()

  // Secret reveal block.
  const revealBlock = page.getByText(/copy now, this is the only time/i)
  await expect(revealBlock).toBeVisible({ timeout: 5_000 })
  const secret = (
    await page
      .locator('code')
      .filter({ hasText: /^st_pk_/ })
      .first()
      .textContent()
  )?.trim()
  expect(secret).toMatch(/^st_pk_[a-z0-9]{20,}$/)

  // Active list row appears.
  await expect(page.getByRole('cell', { name: 'insight-prod' })).toBeVisible()
  await expect(page.getByText('public', { exact: true })).toBeVisible()

  // Quickstart snippet has the live secret pasted in.
  const initSnippet = page.locator('pre').filter({ hasText: 'Sentori.init' })
  await expect(initSnippet).toContainText(secret!)

  // Revoke flow — accept the confirm dialog up front, then click.
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: /revoke/i }).click()
  await expect(page.getByText(/no active tokens yet/i)).toBeVisible({ timeout: 5_000 })

  await ctx.close()
})
