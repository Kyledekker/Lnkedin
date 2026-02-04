// FILE: playwright-linkedin-login/login.ts

import { chromium } from "playwright";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

/**
 * Constants
 */
const LINKEDIN_LOGIN_URL = "https://www.linkedin.com/login";
const LINKEDIN_FEED_URL = "https://www.linkedin.com/feed/";
const SESSION_PATH = "session/linkedin-session.json";

const DEFAULT_TIMEOUT = 60_000; // LinkedIn can be slow
const ACTION_TIMEOUT = 20_000;

/**
 * Helper: Ensure required env vars exist
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`❌ Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

/**
 * Helper: Headless mode config
 */
function isHeadless(): boolean {
  return (process.env.HEADLESS ?? "true").toLowerCase() === "true";
}

/**
 * Helper: Ensure session directory exists
 */
function ensureSessionDir() {
  const sessionDir = path.dirname(SESSION_PATH);
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
    console.log(`📁 Created session directory: ${sessionDir}`);
  }
}

/**
 * Helper: Detect likely auth issues
 */
function isLoginOrChallengeUrl(url: string) {
  return (
    url.includes("/login") ||
    url.includes("/checkpoint") ||
    url.includes("/challenge")
  );
}

async function main() {
  console.log("🚀 Starting LinkedIn login flow...");

  const email = requireEnv("LINKEDIN_EMAIL");
  const password = requireEnv("LINKEDIN_PASSWORD");

  ensureSessionDir();

  const browser = await chromium.launch({ headless: isHeadless() });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.setDefaultTimeout(DEFAULT_TIMEOUT);

  try {
    console.log(`🌍 Opening login page: ${LINKEDIN_LOGIN_URL}`);
    await page.goto(LINKEDIN_LOGIN_URL, { waitUntil: "domcontentloaded" });

    // Use resilient selectors
    const emailInput = page.locator('input[name="session_key"]');
    const passInput = page.locator('input[name="session_password"]');
    const submitBtn = page.locator('button[type="submit"]');

    await emailInput.waitFor({ state: "visible", timeout: ACTION_TIMEOUT });
    await passInput.waitFor({ state: "visible", timeout: ACTION_TIMEOUT });

    console.log("✍️ Filling credentials...");
    await emailInput.fill(email);
    await passInput.fill(password);

    console.log("🔑 Submitting login...");
    await submitBtn.click();

    // IMPORTANT: LinkedIn often does SPA transitions + background requests.
    // Avoid waitForNavigation/networkidle. Instead, wait for URL OR a logged-in element.
    console.log("⏳ Waiting for post-login state...");
    const globalNav = page.locator("header.global-nav");

    const result = await Promise.race([
      // Logged-in URL
      page
        .waitForURL(/linkedin\.com\/feed\/?/, { timeout: DEFAULT_TIMEOUT })
        .then(() => "FEED_URL"),
      // Checkpoint / challenge / login redirects
      page
        .waitForURL(/linkedin\.com\/(checkpoint|challenge|login)/, {
          timeout: DEFAULT_TIMEOUT,
        })
        .then(() => "CHALLENGE_URL"),
      // Logged-in UI indicator
      globalNav
        .waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT })
        .then(() => "GLOBAL_NAV"),
    ]).catch(() => "TIMEOUT");

    const currentUrl = page.url();
    console.log(`🔎 Post-login result: ${result}, URL: ${currentUrl}`);

    // If we hit checkpoint/challenge, user must complete manual verification
    if (result === "CHALLENGE_URL" || isLoginOrChallengeUrl(currentUrl)) {
      throw new Error(
        `LinkedIn requires verification (2FA/CAPTCHA/checkpoint). ` +
          `Re-run with HEADLESS=false, complete the prompts, then re-run login to save session.\n` +
          `Current URL: ${currentUrl}`
      );
    }

    // Ensure we're on feed (some flows land elsewhere but authenticated)
    console.log(`➡️ Navigating to feed for verification: ${LINKEDIN_FEED_URL}`);
    await page.goto(LINKEDIN_FEED_URL, { waitUntil: "domcontentloaded" });

    // Verify authenticated: not on /login and global nav exists
    if (page.url().includes("/login")) {
      throw new Error("Login failed: redirected to /login when accessing /feed.");
    }

    await globalNav.waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT });

    console.log("✅ Login verified. Saving storageState...");
    await context.storageState({ path: SESSION_PATH });

    console.log(`💾 Session saved to: ${SESSION_PATH}`);
    console.log("🎉 Done!");
  } catch (err: any) {
    console.error("❌ Unexpected error during login flow:");
    console.error(err?.message ?? err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
