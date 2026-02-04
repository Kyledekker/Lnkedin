// FILE: playwright-linkedin-login/reuse-session.ts

import { chromium } from "playwright";
import dotenv from "dotenv";
import fs from "fs";
import { searchJobsAndWriteTxt } from "./jobs-search";

dotenv.config();

const LINKEDIN_FEED_URL = "https://www.linkedin.com/feed/";
const SESSION_PATH = "session/linkedin-session.json";

const DEFAULT_TIMEOUT = 60_000;

function isHeadless(): boolean {
  return (process.env.HEADLESS ?? "true").toLowerCase() === "true";
}

function isLoggedOutOrChallengeUrl(url: string) {
  return (
    url.includes("/login") ||
    url.includes("/checkpoint") ||
    url.includes("/challenge")
  );
}

async function main() {
  console.log("♻️ Reusing saved LinkedIn session...");
  console.log(`📄 storageState: ${SESSION_PATH}`);

  if (!fs.existsSync(SESSION_PATH)) {
    console.error("❌ Session file not found.");
    console.error("👉 Run: npm run login");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: isHeadless() });
  const context = await browser.newContext({ storageState: SESSION_PATH });
  const page = await context.newPage();

  page.setDefaultTimeout(DEFAULT_TIMEOUT);

  try {
    console.log(`🌍 Navigating to: ${LINKEDIN_FEED_URL}`);
    await page.goto(LINKEDIN_FEED_URL, { waitUntil: "domcontentloaded" });

    const globalNav = page.locator("header.global-nav");

    console.log("⏳ Waiting for authenticated state (global nav) OR logout redirect...");
    const outcome = await Promise.race([
      globalNav
        .waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT })
        .then(() => "AUTH_OK"),
      page
        .waitForURL(/linkedin\.com\/(login|checkpoint|challenge)/, {
          timeout: DEFAULT_TIMEOUT,
        })
        .then(() => "LOGGED_OUT"),
    ]).catch(() => "TIMEOUT");

    const currentUrl = page.url();
    console.log(`🔎 Outcome: ${outcome}`);
    console.log(`🔗 Current URL: ${currentUrl}`);

    if (outcome === "LOGGED_OUT" || isLoggedOutOrChallengeUrl(currentUrl)) {
      console.error("❌ Session expired/invalid or LinkedIn requires verification.");
      console.error("👉 Re-run: npm run login");
      console.error("   Tip: Set HEADLESS=false if checkpoint/2FA appears.");
      process.exit(1);
    }

    const loginFormVisible = await page
      .locator('input[name="session_key"]')
      .isVisible()
      .catch(() => false);

    if (loginFormVisible) {
      console.error("❌ Session appears logged out (login form detected).");
      console.error("👉 Re-run: npm run login");
      process.exit(1);
    }

    console.log("✅ Session is valid — you are authenticated.");
    console.log(`📄 Page title: ${await page.title()}`);

    await searchJobsAndWriteTxt(page);
  } catch (err: any) {
    console.error("❌ Failed during session reuse / job search.");
    console.error(err?.message ?? err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
