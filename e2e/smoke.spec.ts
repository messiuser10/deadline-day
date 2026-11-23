import { expect, test, type Page } from '@playwright/test';

/**
 * Smoke test on a phone-sized screen: a guest creates a game, adds two bots, plays the whole auction
 * (nominating on their turns, bidding once), watches the reveal, plays the season to the end and opens
 * the results.
 */
test('create a game, add bots, run the auction and play a season', async ({ page }) => {
  await page.goto('/');

  // First visit: the How to Play walkthrough opens by itself.
  const tour = page.getByRole('dialog', { name: 'How to play' });
  await expect(tour).toBeVisible();
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour.getByText('Step 2 of 5')).toBeVisible();
  await tour.getByRole('button', { name: 'Skip' }).click();
  await expect(tour).toBeHidden();
  await expect(page.getByText('unofficial fan game')).toBeVisible();

  // Create a game as a guest, with short timers.
  await page.getByRole('link', { name: 'Create game' }).click();
  await page.getByLabel('Your name').fill('Smoke Tester');
  await page.getByRole('button', { name: 'Play as guest' }).click();
  await page.getByLabel('Game name').fill('Smoke Test Cup');
  await setNumber(page, 'Max teams', 3);
  await setNumber(page, 'Nomination timer', 5);
  await setNumber(page, 'Lot timer', 3);
  await setNumber(page, 'Anti-snipe reset', 0);
  await page.getByRole('button', { name: 'Create lobby' }).click();

  // Lobby: two bots, then start.
  await expect(page).toHaveURL(/\/lobby\/[A-Z0-9]{6}$/);
  const code = page.url().split('/').pop()!;
  await page.getByRole('button', { name: '+ Easy' }).click();
  await expect(page.getByRole('button', { name: '+ Medium' })).toBeEnabled();
  await page.getByRole('button', { name: '+ Medium' }).click();
  await page.getByRole('button', { name: /^(Start auction|Force start)$/ }).click();

  // Auction: nominate whenever it is our turn, bid once, until every XI is full.
  await expect(page).toHaveURL(new RegExp(`/auction/${code}$`), { timeout: 20_000 });
  await expect(page.getByText('Live auction')).toBeVisible();
  const deadline = Date.now() + 6 * 60_000;
  let bid = false;
  let sold = false;
  while (!page.url().includes('/reveal/')) {
    expect(Date.now(), 'the auction should finish within six minutes').toBeLessThan(deadline);
    sold ||= await page.getByText('Sold', { exact: true }).isVisible();
    const choose = page.getByRole('button', { name: 'Your turn: choose a player' });
    if (await choose.isVisible()) await nominate(page, choose);
    if (!bid) {
      const quick = page.getByRole('button', { name: /^Bid \$\d+M$/ }).first();
      if ((await quick.isVisible()) && (await quick.isEnabled())) bid = await quick.click({ timeout: 1000 }).then(() => true, () => false);
    }
    await page.waitForTimeout(250);
  }
  expect(sold, 'a SOLD stamp was shown').toBe(true);

  // Reveal, then the season (the host can start it straight away).
  const startSeason = page.getByRole('button', { name: 'Start season' });
  await startSeason.click({ timeout: 30_000 }).catch(() => undefined);
  await expect(page).toHaveURL(new RegExp(`/season/${code}`), { timeout: 60_000 });
  await page.getByRole('button', { name: 'Skip to the end' }).first().click();
  await expect(page.getByText('Champions', { exact: true })).toBeVisible();

  // Results: awards and grades.
  await page.getByRole('link', { name: 'See awards and grades' }).click();
  await expect(page).toHaveURL(new RegExp(`/results/${code}`));
  await expect(page.getByText('Awards', { exact: true }).first()).toBeVisible();
});

/** Type into a settings stepper and leave the field, so the value is clamped and kept. */
async function setNumber(page: Page, label: string, value: number) {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(String(value));
  await input.blur();
  await expect(input).toHaveValue(String(value));
}

/** Pick the first player we can buy from the pool sheet and open at the base price. */
async function nominate(page: Page, choose: ReturnType<Page['getByRole']>) {
  try {
    await choose.click({ timeout: 1000 });
    const sheet = page.getByRole('dialog', { name: 'Choose a player' });
    await sheet.locator('button:enabled', { hasText: /^Nominate$/ }).first().click({ timeout: 2000 });
    await page.getByRole('dialog', { name: 'Nominate' }).getByRole('button', { name: /^Nominate for/ }).click({ timeout: 2000 });
  } catch {
    // The turn ran out (the server auto-nominates) or the sheet closed under us: carry on.
    await page.keyboard.press('Escape').catch(() => undefined);
  }
}
