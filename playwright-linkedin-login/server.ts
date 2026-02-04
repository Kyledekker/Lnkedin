// FILE: server.ts

import express from "express";
import dotenv from "dotenv";
import { chromium } from "playwright";
import { fetchLinkedInJobsAiHr } from "./src/jobs-ai-hr";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);
const HEADLESS = (process.env.HEADLESS ?? "true").toLowerCase() !== "false";

const STORAGE_STATE_PATH = "session/linkedin-session.json";
const FEED_URL = "https://www.linkedin.com/feed/";

app.get("/health", (_req, res) => {
  res.json({ ok: true, message: "LinkedIn Job API running" });
});

/**
 * GET /api/v1/jobs
 * Returns:
 * {
 *   "jobs": [
 *     {
 *       "jobTitle": "...",
 *       "description": "...",
 *       "link": "...",
 *       "contact": "...",
 *       "company": "...",
 *       "postingDate": "YYYY-MM-DD"
 *     }
 *   ]
 * }
 */
app.get("/api/v1/jobs", async (_req, res) => {
  const startedAt = Date.now();

  try {
    console.log("🚀 GET /api/v1/jobs -> starting Playwright job fetch...");

    const browser = await chromium.launch({
      headless: HEADLESS,
      args: ["--disable-dev-shm-usage"],
    });

    const context = await browser.newContext({
      storageState: STORAGE_STATE_PATH,
      viewport: { width: 1280, height: 800 },
    });

    const page = await context.newPage();
    page.setDefaultTimeout(60_000);

    // Verify logged-in session
    console.log("🔐 Checking authentication...");
    await page.goto(FEED_URL, { waitUntil: "domcontentloaded" });

    if (page.url().includes("/login") || page.url().includes("/checkpoint") || page.url().includes("/challenge")) {
      throw new Error("AUTH_REQUIRED: Session expired. Run npm run login again.");
    }

    console.log("✅ Authenticated. Fetching jobs...");
    const jobs = await fetchLinkedInJobsAiHr(page);

    await context.close();
    await browser.close();

    return res.json({
      jobs,
      meta: {
        count: jobs.length,
        tookMs: Date.now() - startedAt,
        headless: HEADLESS,
      },
    });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    console.error("❌ /api/v1/jobs error:", msg);

    if (msg.includes("AUTH_REQUIRED")) {
      return res.status(401).json({
        error: "AUTH_REQUIRED",
        message: "Session expired or invalid. Re-run npm run login to refresh session.",
      });
    }

    return res.status(500).json({
      error: "INTERNAL_ERROR",
      message: msg,
    });
  }
});

app.listen(PORT, () => {
  console.log("========================================");
  console.log("✅ LinkedIn Jobs REST API running");
  console.log(`🌍 URL: http://localhost:${PORT}`);
  console.log("➡️  GET  /health");
  console.log("➡️  GET  /api/v1/jobs");
  console.log("========================================");
});
