import fs from "fs";
import { chromium, Page } from "playwright";

const LINKEDIN_FEED_URL = "https://www.linkedin.com/feed/";
const SESSION_PATH = process.env.SESSION_PATH || "session/linkedin-session.json";
const DEFAULT_TIMEOUT = 60_000;

function isHeadless(): boolean {
  return (process.env.HEADLESS ?? "true").toLowerCase() === "true";
}

function isLoggedOutOrChallengeUrl(url: string) {
  return url.includes("/login") || url.includes("/checkpoint") || url.includes("/challenge");
}

export async function runWithLinkedInSession<T>(work: (page: Page) => Promise<T>): Promise<T> {
  if (!fs.existsSync(SESSION_PATH)) {
    throw new Error(`SESSION_MISSING: Session file not found at ${SESSION_PATH}. Run npm run login first.`);
  }

  const browser = await chromium.launch({
    headless: isHeadless(),
    args: ["--disable-dev-shm-usage"],
  });

  const context = await browser.newContext({ storageState: SESSION_PATH });
  const page = await context.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT);

  try {
    await page.goto(LINKEDIN_FEED_URL, { waitUntil: "domcontentloaded" });

    if (isLoggedOutOrChallengeUrl(page.url())) {
      throw new Error("AUTH_REQUIRED: Session expired/invalid or verification required.");
    }

    const loginVisible = await page.locator('input[name="session_key"]').isVisible().catch(() => false);
    if (loginVisible) {
      throw new Error("AUTH_REQUIRED: LinkedIn login form detected.");
    }

    return await work(page);
  } finally {
    await context.close();
    await browser.close();
  }
}
