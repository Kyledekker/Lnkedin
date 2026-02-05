// FILE: src/jobs-ai-hr.ts
//
// Robust LinkedIn job fetcher for query "AI" + "HR"

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

// 120s ist für LinkedIn realistisch oft zu niedrig.
// Stell das ruhig höher, sonst endet es "korrekt" aber zu früh.
const HARD_RUN_TIMEOUT_MS = 8 * 60_000;

const MAX_RESULTS_TO_PROCESS = 40;
const MAX_SCROLL_ROUNDS = 10;

const SEARCH_URL =
  'https://www.linkedin.com/jobs/search-results/?keywords=%22AI%22%20%2B%20%22HR%22&origin=SWITCH_SEARCH_VERTICAL';

const AI_REGEX =
  /\b(ai|artificial intelligence|ki|k\.?i\.?|machine learning|ml\b|genai|generative ai|llm|large language model)\b/i;

const HR_REGEX =
  /\b(hr|human resources|people\b|talent\b|recruit(ing|er|ment)|people operations|personal(wesen|abteilung)?)\b/i;

// kurze Timeouts, damit wir nie ewig "warten"
const NAV_TIMEOUT_JOB_MS = 15_000;
const NAV_TIMEOUT_SEARCH_MS = 15_000;
const JOB_SELECTOR_TIMEOUT = 2_500;

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
    if (await btn.isVisible({ timeout: 800 }).catch(() => false)) {
      await btn.click({ timeout: 2_000 }).catch(() => {});
      await page.waitForTimeout(300);
      return;
    }
  }
}

async function gotoWithTimeout(page: Page, url: string, ms: number, tag: string) {
  await Promise.race([
    page.goto(url, { waitUntil: "domcontentloaded" }),
    page.waitForTimeout(ms).then(() => {
      throw new Error(`NAV_TIMEOUT_${tag}: ${ms}ms (${url})`);
    }),
  ]);
}

async function findLeftListScroller(page: Page): Promise<ElementHandle<HTMLElement> | null> {
  // Priorisierte Kandidaten (LinkedIn UI-Klassen wechseln manchmal, aber das ist oft stabiler als "best score")
  const handle = await page.evaluateHandle(() => {
    const candidates = [
      // häufig bei job search
      document.querySelector<HTMLElement>('div.jobs-search-results-list'),
      document.querySelector<HTMLElement>('div.jobs-search-results-list__container'),
      document.querySelector<HTMLElement>('div.scaffold-layout__list-container'),
      document.querySelector<HTMLElement>('main [role="main"] .scaffold-layout__list-container'),
    ].filter(Boolean) as HTMLElement[];

    const isScrollable = (el: HTMLElement) =>
      el.scrollHeight > el.clientHeight + 30 &&
      (getComputedStyle(el).overflowY === "auto" || getComputedStyle(el).overflowY === "scroll");

    for (const el of candidates) {
      if (isScrollable(el) && el.querySelector('a[href*="/jobs/view/"]')) return el;
    }

    // fallback: scoring wie vorher
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

async function waitForNewSeenCount(prevSeen: number, seenRef: () => number, page: Page) {
  const start = Date.now();
  while (Date.now() - start < 8_000) {
    if (seenRef() > prevSeen) return true;
    // manchmal virtualisiert LinkedIn; kurz warten
    await page.waitForTimeout(300);
  }
  return false;
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
  await page.waitForTimeout(500);
}

async function waitForJobsOrDetectBlock(page: Page): Promise<"OK" | "BLOCKED"> {
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    await handleConsentIfPresent(page);

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
      .isVisible({ timeout: 800 })
      .catch(() => false);

    if (blocked) return "BLOCKED";

    const count = await page.locator('a[href*="/jobs/view/"]').count().catch(() => 0);
    if (count > 0) return "OK";

    await page.waitForTimeout(400);
  }

  return "BLOCKED";
}

async function readJobPageDetails(page: Page) {
  // Wichtig: warten bis Job-Header wirklich da ist
  await page
    .locator(
      [
        "h1",
        ".jobs-unified-top-card__job-title",
        ".job-details-jobs-unified-top-card__job-title",
      ].join(",")
    )
    .first()
    .waitFor({ timeout: 10_000 })
    .catch(() => {});

  const titleLoc = page
    .locator(
      [
        ".jobs-unified-top-card__job-title",
        ".job-details-jobs-unified-top-card__job-title",
        "h1",
      ].join(",")
    )
    .first();

  const companyLoc = page
    .locator(
      [
        ".jobs-unified-top-card__company-name",
        ".job-details-jobs-unified-top-card__company-name",
        'a[data-control-name="company_link"]',
      ].join(",")
    )
    .first();

  // Expand description if possible
  const showMore = page.locator('button:has-text("Mehr anzeigen"), button:has-text("Show more")').first();
  if (await showMore.isVisible({ timeout: 800 }).catch(() => false)) {
    await showMore.click({ timeout: 1_500 }).catch(() => {});
    await page.waitForTimeout(200);
  }

  const descLoc = page
    .locator(
      [
        ".jobs-description-content__text",
        ".jobs-box__html-content",
        "#job-details",
        'div[id*="job-details"]',
      ].join(",")
    )
    .first();

  const jobTitle =
    normalizeText(await titleLoc.textContent({ timeout: JOB_SELECTOR_TIMEOUT }).catch(() => "")) ||
    normalizeText(await page.title().catch(() => "")) ||
    "(unknown title)";

  const company =
    normalizeText(await companyLoc.textContent({ timeout: JOB_SELECTOR_TIMEOUT }).catch(() => "")) ||
    "(unknown company)";

  let description = normalizeText(await descLoc.textContent({ timeout: JOB_SELECTOR_TIMEOUT }).catch(() => ""));
  if (!description || description.length < 50) {
    // Fallback: aber gezielt aus dem Job-Details Bereich, nicht aus dem ganzen Body
    description = normalizeText(
      await page
        .evaluate(() => {
          const root =
            document.querySelector('[class*="jobs-description"]') ||
            document.querySelector('[id*="job-details"]') ||
            document.querySelector("main");
          return (root?.textContent || "").slice(0, 15000);
        })
        .catch(() => "")
    );
  }

  // Posting date best-effort
  const timeLoc = page.locator("time[datetime]").first();
  let postingDate = "";
  const datetime = await timeLoc.getAttribute("datetime").catch(() => null);
  if (datetime) postingDate = toIsoDateOrEmpty(datetime);

  return { jobTitle, company, description, postingDate };
}


function matchesAIandHR(text: string) {
  const ai = AI_REGEX.test(text);
  const hr = HR_REGEX.test(text);
  return { ai, hr, ok: ai && hr };
}

async function withHardTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`TIMEOUT: Job fetch exceeded ${ms}ms`)), ms);
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
      await gotoWithTimeout(page, SEARCH_URL, NAV_TIMEOUT_SEARCH_MS, "search");
      await handleConsentIfPresent(page);

      const state0 = await waitForJobsOrDetectBlock(page);
      if (state0 === "BLOCKED") {
        throw new Error(
          "BLOCKED_OR_NO_JOBS: LinkedIn did not render job links (possible verification/anti-bot). Try HEADLESS=false."
        );
      }

      const seen = new Set<string>();
      const jobs: ApiJob[] = [];

      let stagnant = 0;
      let lastSeen = 0;

      for (let round = 0; round < MAX_SCROLL_ROUNDS; round++) {
        console.log(`🧭 Round ${round + 1}/${MAX_SCROLL_ROUNDS} (seen=${seen.size}, jobs=${jobs.length})`);

        await handleConsentIfPresent(page);

        const state = await waitForJobsOrDetectBlock(page);
        if (state === "BLOCKED") {
          throw new Error("BLOCKED_MIDRUN: verification/anti-bot detected.");
        }

        // ✅ WICHTIG: IMMER neu holen (nicht über goto hinweg wiederverwenden!)
        const scroller = await findLeftListScroller(page);

        const hrefsRaw = await collectLeftHrefs(page, scroller);
        const hrefs = hrefsRaw
          .map((h) => h?.trim())
          .filter(Boolean)
          .map((h) => normalizeJobUrl(h!))
          .filter(Boolean) as string[];

        console.log(`   ↳ visible hrefs: ${hrefs.length}`);

        for (const jobUrl of hrefs) {
          if (jobs.length >= MAX_RESULTS_TO_PROCESS) break;
          if (seen.has(jobUrl)) continue;

          seen.add(jobUrl);
          console.log(`➡️ Open job: ${jobUrl}`);

          try {
            await gotoWithTimeout(page, jobUrl, NAV_TIMEOUT_JOB_MS, "job");
            await page.waitForTimeout(350);

            const details = await readJobPageDetails(page);
            const haystack = `${details.jobTitle}\n${details.company}\n${details.description}`;
            const m = matchesAIandHR(haystack);

            if (m.ok) {
              jobs.push({
                jobTitle: details.jobTitle,
                description: details.description,
                link: jobUrl,
                contact: "",
                company: details.company,
                postingDate: details.postingDate,
              });
              console.log(`   ✅ match (jobs=${jobs.length})`);
              console.log("📌 FOUND JOB:", details.jobTitle, "-", details.company);
            } else {
              console.log(`   ⏭️ no match`);
            }
          } catch (e: any) {
            console.warn(`   ⚠️ job failed: ${String(e?.message ?? e)}`);
          } finally {
            // ✅ Egal was passiert: zurück zur Ergebnisliste
            await gotoWithTimeout(page, SEARCH_URL, NAV_TIMEOUT_SEARCH_MS, "search-back").catch(() => {});
            await page.waitForTimeout(300);
          }
        }

        if (jobs.length >= MAX_RESULTS_TO_PROCESS) break;

        // --- NEU: Stagnation erst nach echtem Scroll prüfen ---
        const prevSeen = seen.size;

        // scroll (Scroller neu holen!)
        const scrollerAfter = await findLeftListScroller(page);
        await scrollLeft(page, scrollerAfter, 2200);

        // nach scroll nochmal hrefs sammeln, um sicher zu sein, dass sich was geändert hat
        const scrollerCheck = await findLeftListScroller(page);
        const hrefsAfterRaw = await collectLeftHrefs(page, scrollerCheck);

        const hrefsAfter = hrefsAfterRaw
        .map((h) => h?.trim())
        .filter(Boolean)
        .map((h) => normalizeJobUrl(h!))
        .filter(Boolean) as string[];

        const uniqueAfter = new Set(hrefsAfter);

        console.log(`   ↳ after scroll unique hrefs: ${uniqueAfter.size} (seen=${seen.size})`);

        // Wenn nach scroll immer noch nichts Neues, erst dann stagnation zählen
        if (seen.size === prevSeen) stagnant++;
        else stagnant = 0;

        if (stagnant >= 5) {
        console.log(`🛑 Stagnant (no new jobs after multiple scrolls) -> stopping`);
        break;
        }

      }

      console.log(`✅ Done. Jobs matched (AI+HR): ${jobs.length}`);
      return jobs;
    })(),
    HARD_RUN_TIMEOUT_MS
  );
}
