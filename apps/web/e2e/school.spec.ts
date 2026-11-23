import { expect, test, type Page } from '@playwright/test';

async function loginAs(page: Page, school: string, role: string) {
  await page.goto('/login');
  await page.getByRole('textbox').first().fill(school);
  await page.locator('select').selectOption(role);
  await page.locator('button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

test('login refuses a malformed school code and shows the error', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox').first().fill('Bad Code!');
  await page.locator('button[type=submit]').click();
  await expect(page.locator('form [role=alert]')).toContainText('invalid');
});

test('an admin of the Gabon demo lycée signs in and sees the active modules page', async ({ page }) => {
  await loginAs(page, 'ga_lycee', 'admin');
  await expect(page.getByRole('heading', { name: 'ÉcoleManager Pro' })).toBeVisible();
});

test('administration shows the grading scale of the school (configuration, not code)', async ({ page }) => {
  await loginAs(page, 'ga_lycee', 'admin');
  await page.goto('/administration');
  const section = page.getByRole('region', { name: /Échelle de notation/ });
  await expect(section).toBeVisible();
  await expect(section).toContainText('num20');          // seeded Gabonese scale of the lycée
  await expect(section).toContainText('50 %');           // warning threshold stored as a % of the maximum
});

test('the primary school uses the 10-point scale seeded for it', async ({ page }) => {
  await loginAs(page, 'ga_primaire', 'admin');
  await page.goto('/administration');
  await expect(page.getByRole('region', { name: /Échelle de notation/ })).toContainText('num10');
});

test('timetable page is reachable and offers week and month views', async ({ page }) => {
  await loginAs(page, 'ga_college', 'admin');
  await page.goto('/timetable');
  await expect(page.getByRole('heading', { name: /Emploi du temps/ })).toBeVisible();
  await page.getByRole('button', { name: /Mois/ }).click();
  await expect(page.getByLabel('mois')).toBeVisible();
});
