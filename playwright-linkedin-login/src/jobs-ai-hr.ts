// FILE: src/jobs-ai-hr.ts
//
// Fetch jobs for query: "AI" + "HR"
// Returns normalized objects for your schema.
// Notes:
// - "contact" is often not available on LinkedIn job pages; we return "".
// - postingDate is best-effort (tries to parse date from the page); may be "" if not found.

import { ElementHandle, Page } from "playwright";

export type ApiJob = {
  jobTitle: string;
  description: string;
  link: string;
  contact: string;
  company: string;
  postingDate: string; // YYYY-MM-DD (best-effort)
};

const DEFAULT_TIMEOUT = 60_000;
const MAX_RESULTS_TO_PROCESS = 80;
const MAX_SCROLL_ROUNDS = 25;

const SEARCH_URL =
  'https://www.linkedin.com/jobs/search-results/?keywords=%22AI%22%20%2B%20%22HR%22&origin=SWITCH_SEARCH_VERTICAL';

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

function toIsoDateOrEmpty(input: string): string {
  // very defensive: try Date parsing; if fails return ""
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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
      await page.waitForTimeout(600);
      return;
    }
  }
}

/**
 * Find the scrollable container that contains the jobs list (left column),
 * and then we extract hrefs only inside it.
 */
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
    await scroller
      .evaluate((el, delta) => {
        el.scrollTop = el.scrollTop + delta;
      }, deltaPx)
      .catch(() => {});
  } else {
    await page.evaluate((delta) => window.scrollBy(0, delta), deltaPx).catch(() => {});
  }
  await page.waitForTimeout(650);
}

async function waitForAnyJobLinks(page: Page) {
  const start = Date.now();
  while (Date.now() - start < DEFAULT_TIMEOUT) {
    await handleConsentIfPresent(page);

    const count = await page.locator('a[href*="/jobs/view/"]').count().catch(() => 0);
    if (count > 0) return;

    await page.waitForTimeout(400);
  }
}

async function collectLeftHrefs(page: Page, scroller: ElementHandle<HTMLElement> | null) {
  if (!scroller) {
    const hrefs = await page
      .locator('a[href*="/jobs/view/"]')
      .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href") || ""))
      .catch(() => []);
    return hrefs;
  }

  const hrefs = await scroller
    .evaluate((el) => {
      const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('a[href*="/jobs/view/"]'));
      return links.map((a) => a.getAttribute("href") || "");
    })
    .catch(() => []);
  return hrefs;
}

async function readJobPageDetails(page: Page) {
  // Title
  const titleLoc = page.locator(["h1", "h2.jobs-unified-top-card__job-title"].join(",")).first();

  // Company
  const companyLoc = page
    .locator(
      [
        "a.jobs-unified-top-card__company-name",
        "span.jobs-unified-top-card__company-name",
        "div.jobs-unified-top-card__company-name",
        'a[data-control-name="company_link"]',
      ].join(",")
    )
    .first();

  // Posting date: best-effort
  // LinkedIn commonly uses <time datetime="..."> or relative strings in a span.
  const timeLoc = page.locator('time[datetime]').first();
  const postedTextLoc = page.locator(
    [
      "span.jobs-unified-top-card__posted-date",
      "span.jobs-unified-top-card__subtitle-secondary-grouping",
      "span.jobs-unified-top-card__bullet",
    ].join(",")
  ).first();

  // Expand description
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
        "section.description",
        "div.jobs-description",
      ].join(",")
    )
    .first();

  const jobTitle = normalizeText(await titleLoc.textContent().catch(() => "")) || "(unknown title)";
  const company = normalizeText(await companyLoc.textContent().catch(() => "")) || "(unknown company)";
  const description = normalizeText(await descLoc.textContent().catch(() => ""));

  // postingDate parsing
  let postingDate = "";
  const datetime = await timeLoc.getAttribute("datetime").catch(() => null);
  if (datetime) postingDate = toIsoDateOrEmpty(datetime);

  if (!postingDate) {
    const postedText = normalizeText(await postedTextLoc.textContent().catch(() => ""));
    // If postedText is like "Vor 2 Wochen" we cannot reliably convert without locale rules; leave "".
    // If it's an absolute date, Date() may parse it.
    postingDate = toIsoDateOrEmpty(postedText);
  }

  return { jobTitle, company, description, postingDate };
}

function matchesAIandHR(text: string) {
  const ai = AI_REGEX.test(text);
  const hr = HR_REGEX.test(text);
  return { ai, hr, ok: ai && hr };
}

/**
 * Main function used by the API route
 */
export async function fetchLinkedInJobsAiHr(page: Page): Promise<ApiJob[]> {
  page.setDefaultTimeout(DEFAULT_TIMEOUT);

  await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded" });
  await handleConsentIfPresent(page);

  await waitForAnyJobLinks(page);

  const scroller = await findLeftListScroller(page);

  const seen = new Set<string>();
  const jobs: ApiJob[] = [];

  let stagnant = 0;
  let lastSeen = 0;

  for (let round = 0; round < MAX_SCROLL_ROUNDS; round++) {
    await handleConsentIfPresent(page);

    const hrefsRaw = await collectLeftHrefs(page, scroller);
    const hrefs = hrefsRaw
      .map((h) => h?.trim())
      .filter(Boolean)
      .map((h) => normalizeJobUrl(h!))
      .filter(Boolean) as string[];

    for (const jobUrl of hrefs) {
      if (jobs.length >= MAX_RESULTS_TO_PROCESS) break;
      if (seen.has(jobUrl)) continue;

      seen.add(jobUrl);

      // Navigate directly to job page (stable vs. clicking virtualized list)
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
        contact: "", // best-effort: LinkedIn usually doesn't provide a stable contact name
        company: details.company,
        postingDate: details.postingDate, // may be ""
      });
    }

    if (jobs.length >= MAX_RESULTS_TO_PROCESS) break;

    // stagnation detection
    if (seen.size === lastSeen) stagnant++;
    else stagnant = 0;
    lastSeen = seen.size;

    if (stagnant >= 4) break;

    // back to results and scroll
    await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(800);
    await scrollLeft(page, scroller, 1800);
  }

  return jobs;
}
