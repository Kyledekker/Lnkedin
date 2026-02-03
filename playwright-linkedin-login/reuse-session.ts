import { chromium, Page } from 'playwright';
import * as dotenv from 'dotenv';
import { existsSync } from 'fs';
import path from 'path';

dotenv.config();

const LINKEDIN_FEED_URL = 'https://www.linkedin.com/feed/';
const STORAGE_STATE_PATH = path.join('session', 'linkedin-session.json');
const DEFAULT_TIMEOUT_MS = 30_000;
const HEADLESS = process.env.HEADLESS?.toLowerCase() !== 'false';

const isLoggedIn = async (page: Page): Promise<boolean> => {
  const currentUrl = page.url();
  if (currentUrl.includes('/login')) {
    return false;
  }

  const globalNav = page.locator('nav[aria-label="Primary"]');
  return globalNav.first().isVisible().catch(() => false);
};

const main = async () => {
  if (!existsSync(STORAGE_STATE_PATH)) {
    console.error('Session file not found. Run login.ts first to generate a session.');
    process.exit(1);
  }

  console.log('Reusing saved LinkedIn session...');

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({
    storageState: STORAGE_STATE_PATH,
    viewport: { width: 1280, height: 720 },
  });

  const page = await context.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);

  await page.goto(LINKEDIN_FEED_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  if (!(await isLoggedIn(page))) {
    console.error('Session expired or invalid. Re-run login.ts to refresh session.');
    await browser.close();
    process.exit(1);
  }

  console.log(`Session valid. Current page title: ${await page.title()}`);

  await browser.close();
};

main().catch((error) => {
  console.error('Unexpected error during session reuse:', error);
  process.exit(1);
});
