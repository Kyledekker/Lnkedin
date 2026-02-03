import { chromium, Page } from 'playwright';
import * as dotenv from 'dotenv';
import { mkdirSync, existsSync } from 'fs';
import path from 'path';

dotenv.config();

const LINKEDIN_LOGIN_URL = 'https://www.linkedin.com/login';
const LINKEDIN_FEED_URL = 'https://www.linkedin.com/feed/';
const STORAGE_STATE_PATH = path.join('session', 'linkedin-session.json');
const DEFAULT_TIMEOUT_MS = 30_000;

const EMAIL = process.env.LINKEDIN_EMAIL;
const PASSWORD = process.env.LINKEDIN_PASSWORD;
const HEADLESS = process.env.HEADLESS?.toLowerCase() !== 'false';

const ensureSessionDirectory = () => {
  const sessionDir = path.dirname(STORAGE_STATE_PATH);
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }
};

const ensureCredentials = () => {
  if (!EMAIL || !PASSWORD) {
    console.error('Missing LINKEDIN_EMAIL or LINKEDIN_PASSWORD in environment.');
    process.exit(1);
  }
};

const isLoggedIn = async (page: Page): Promise<boolean> => {
  const currentUrl = page.url();
  if (currentUrl.includes('/login')) {
    return false;
  }

  const globalNav = page.locator('nav[aria-label="Primary"]');
  return globalNav.first().isVisible().catch(() => false);
};

const main = async () => {
  ensureCredentials();
  ensureSessionDirectory();

  console.log('Starting LinkedIn login flow...');

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });

  const page = await context.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);

  await page.goto(LINKEDIN_LOGIN_URL, { waitUntil: 'domcontentloaded' });

  await page.locator('input[name="session_key"]').fill(EMAIL as string);
  await page.locator('input[name="session_password"]').fill(PASSWORD as string);

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.locator('button[type="submit"]').click(),
  ]);

  await page.goto(LINKEDIN_FEED_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  if (!(await isLoggedIn(page))) {
    console.error('Login failed or additional verification required.');
    await browser.close();
    process.exit(1);
  }

  await context.storageState({ path: STORAGE_STATE_PATH });
  console.log(`Login successful. Storage state saved to ${STORAGE_STATE_PATH}`);

  await browser.close();
};

main().catch((error) => {
  console.error('Unexpected error during login flow:', error);
  process.exit(1);
});
