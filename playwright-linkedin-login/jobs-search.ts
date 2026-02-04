// FILE: src/jobs-ai-hr.ts

import fs from "fs";
import path from "path";
import { ElementHandle, Page } from "playwright";

export type ApiJob = {
  jobTitle: string;
  description: string;
  link: string;
  contact: string;
  company: string;
  postingDate: string;
};

const DEFAULT_TIMEOUT = 60_000;
const HARD_RUN_TIMEOUT_MS = 120_000; // <- nach 2 Minuten wird abgebrochen (kein Hängen mehr)
const MAX_RESULTS_TO_PROCESS = 40;
const MAX_SCROLL_ROUNDS = 10;

const SEARCH_URL =
  'https://www.linkedin.com/jobs/search-results/?keywords=%22AI%22%20%2B%20%22HR%22&origin=SWITCH_SEARCH_VERTICAL';

const OUT_DIR = "debug";
const AI_REGEX =
  /\b(ai|artificial intelligence|ki|k\.?i\.?|machine learning|ml\b|genai|generative ai|llm|large language model)\b/i;

const HR_REGEX =
  /\b(hr|human resources|people\b|talent\b|recruit(ing|er|ment)|people operations|personal(wesen|abteilung)?)\b/i;

function normalizeText(s: string | null | undefined) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function normalizeJobUrl(href: string) {
  if (!href) return null;
  let abs = href;
  if (abs.startsWith("/")) abs = `https://www.linkedin.com${abs}`;
  if (!abs.includes("/jobs/view/")) return null;
  return abs.split("?")[0];
}

async function ensureDebugDir() {
  const p = path.resolve(OUT_DIR);
  await fs.promises.mkdir(p, { recursive: true }).catch(() => {});
}

async function dumpDebug(page: Page, tag: string) {
  await ensureDebugDir();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.join(OUT_DIR, `${ts}-${tag}`);

  try {
    await page.screenshot({ path: `${base}.png`, fullPage: true });
  } catch {}

  try {
    const html = await page.content();
    await fs.promises.writeFile(`${base}.html`, html, "utf8");
  } catch {}
}

async function handleConsentIfPresent(page: Page) {
  const candidates = [
    'button:has-text("Accept")',
    'button:has-text("I Accept")',
    'button:has-text("Agree")',
    'button:has-text("Allow all cookies")',
    'button:has-text("Accept cookies")',
    'button:has-text("Alle Cookies akzeptieren")',
    'button:has-text("Akzeptieren")',
    'button:has-text("Zustimmen")',
  ];

  for (const sel of candidates) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 2_000 }).catch(() => {});
      await page.waitForTimeout(500);
      return;
    }
  }
}

async function findLeftListScroller(page: Page): Promise<ElementHandle<HTMLElement> | null> {
  const handle = await page.evaluateHandle(() => {
    const isScrollable = (el: HTMLElement) =>
      el.scrollHeight > el.clientHeight + 50 &&
      (getComputedStyle(el).overflowY === "auto" || getComputedStyle(el).overflowY === "scroll");

    const els = Array.from(document.querySelectorAll<HTMLElement>("div, section, aside, main"));

    let best: HTMLElement | null = null;
    let bestScore = 0;

    for (const el of els) {
      if (!isScrollable(el)) continue;
      const links = el.querySelectorAll('a[href*="/jobs/view/"]').length;
      const score = links * 100 + Math.min(el.clientHeight, 1200);
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    return best;
  });

  return (handle.asElement() as ElementHandle<HTMLElement> | null) ?? null;
}

async function scrollLeft(page: Page, scroller: ElementHandle<HTMLElement> | null, deltaPx: number) {
  if (scroller) {
    await scroller.evaluate((el, delta) => {
      el.scrollTop = el.scrollTop + delta;
    }, deltaPx).catch(() => {});
  } else {
    await page.evaluate((delta) => window.scrollBy(0, delta), deltaPx).catch(() => {});
  }
  await page.waitForTimeout(600);
}

async function waitForJobsOrDetectBlock(page: Page): Promise<"OK" | "BLOCKED"> {
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    await handleConsentIfPresent(page);

    // Soft-block indicators
    const blocked = await page
      .locator(
        [
          'text="Sicherheitsüberprüfung"',
          'text="Security Verification"',
          'text="Verify"',
          'text="Überprüfen"',
          'text="Sign in to continue"',
          'text="Melde dich an"',
          'text="Join LinkedIn"',
          'input[name="session_key"]',
        ].join(",")
      )
      .first()
      .isVisible()
      .catch(() => false);

    if (blocked) return "BLOCKED";

    const links = await page.locator('a[href*="/jobs/view/"]').count().catch(() => 0);
    if (links > 0) return "OK";

    await page.waitForTimeout(400);
  }
  return "BLOCKED";
}

async function collectLeftHrefs(page: Page, scroller: ElementHandle<HTMLElement> | null) {
  if (!scroller) {
    return page
      .locator('a[href*="/jobs/view/"]')
      .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href") || ""))
      .catch(() => []);
  }

  return scroller
    .evaluate((el) => {
      const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('a[href*="/jobs/view/"]'));
      return links.map((a) => a.getAttribute("href") || "");
    })
    .catch(() => []);
}

async function readJobPageDetails(page: Page) {
  const titleLoc = page.locator("h1").first();
  const companyLoc = page
    .locator(
      [
        "a.jobs-unified-top-card__company-name",
        "span.jobs-unified-top-card__company-name",
        'a[data-control-name="company_link"]',
      ].join(",")
    )
    .first();

  const showMore = page.locator('button:has-text("Mehr anzeigen"), button:has-text("Show more")').first();
  if (await showMore.isVisible().catch(() => false)) {
    await showMore.click({ timeout: 2_000 }).catch(() => {});
    await page.waitForTimeout(250);
  }

  const descLoc = page
    .locator(
      [
        "div.jobs-description-content__text",
        "div.jobs-box__html-content",
        'div[id*="job-details"]',
      ].join(",")
    )
    .first();

  const jobTitle = normalizeText(await titleLoc.textContent().catch(() => "")) || "(unknown title)";
  const company = normalizeText(await companyLoc.textContent().catch(() => "")) || "(unknown company)";
  const description = normalizeText(await descLoc.textContent().catch(() => ""));

  return { jobTitle, company, description };
}

function matchesAIandHR(text: string) {
  const ai = AI_REGEX.test(text);
  const hr = HR_REGEX.test(text);
  return { ai, hr, ok: ai && hr };
}

async function withHardTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => Promise<void>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(async () => {
      await onTimeout().catch(() => {});
      reject(new Error(`TIMEOUT: Job fetch exceeded ${ms}ms`));
    }, ms);

    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

export async function fetchLinkedInJobsAiHr(page: Page): Promise<ApiJob[]> {
  page.setDefaultTimeout(DEFAULT_TIMEOUT);

  return withHardTimeout(
    (async () => {
      console.log(`🌍 Opening jobs search: ${SEARCH_URL}`);
      await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded" });
      await handleConsentIfPresent(page);

      const state = await waitForJobsOrDetectBlock(page);
      if (state === "BLOCKED") {
        await dumpDebug(page, "blocked-or-nojobs");
        throw new Error(
          "BLOCKED_OR_NO_JOBS: LinkedIn did not render job links (possible verification/anti-bot). Try HEADLESS=false and ensure no verification page is shown."
        );
      }

      const scroller = await findLeftListScroller(page);

      const seen = new Set<string>();
      const jobs: ApiJob[] = [];

      for (let round = 0; round < MAX_SCROLL_ROUNDS; round++) {
        const hrefsRaw = await collectLeftHrefs(page, scroller);
        const hrefs = hrefsRaw
          .map((h) => h?.trim())
          .filter(Boolean)
          .map((h) => normalizeJobUrl(h!))
          .filter(Boolean) as string[];

        console.log(`🧭 Round ${round + 1}/${MAX_SCROLL_ROUNDS}: visible hrefs in left list: ${hrefs.length}`);

        for (const jobUrl of hrefs) {
          if (jobs.length >= MAX_RESULTS_TO_PROCESS) break;
          if (seen.has(jobUrl)) continue;

          seen.add(jobUrl);
          console.log(`➡️ Open job: ${jobUrl}`);

          await page.goto(jobUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
          await page.waitForTimeout(800);

          const details = await readJobPageDetails(page);
          const haystack = `${details.jobTitle}\n${details.company}\n${details.description}`;
          const m = matchesAIandHR(haystack);

          if (!m.ok) continue;

          jobs.push({
            jobTitle: details.jobTitle,
            description: details.description,
            link: jobUrl,
            contact: "",
            company: details.company,
            postingDate: "",
          });
        }

        if (jobs.length >= MAX_RESULTS_TO_PROCESS) break;

        // back to results and scroll further
        await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
        await page.waitForTimeout(800);
        await scrollLeft(page, scroller, 1800);
      }

      console.log(`✅ Done. Jobs matched (AI+HR): ${jobs.length}`);
      return jobs;
    })(),
    HARD_RUN_TIMEOUT_MS,
    async () => {
      await dumpDebug(page, "hard-timeout");
    }
  );
}
