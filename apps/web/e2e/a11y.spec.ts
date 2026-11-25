import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** WCAG 2.1 A/AA automated audit (axe-core). Fails on serious/critical violations; lists every violation on failure. */
const PUBLIC = ['/', '/login', '/visitor', '/legal/privacy', '/legal/terms'];
const STAFF = ['/administration', '/timetable', '/grades', '/absences', '/lessons', '/messages', '/news', '/notifications', '/oaa', '/payments', '/risk', '/resources', '/academic', '/orientation', '/gps'];

async function audit(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const summary = bad.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.help} -> ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(summary, `${path}\n${summary.join('\n')}`).toEqual([]);
}

for (const p of PUBLIC) test(`WCAG 2.1 AA (public) ${p}`, async ({ page }) => { await audit(page, p); });

test.describe('signed-in pages', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox').first().fill('ga_lycee');
    await page.locator('select').selectOption('admin');
    await page.locator('button[type=submit]').click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  });
  for (const p of STAFF) test(`WCAG 2.1 AA ${p}`, async ({ page }) => { await audit(page, p); });
});
