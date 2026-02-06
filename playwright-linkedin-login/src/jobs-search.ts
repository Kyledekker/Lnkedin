import fs from "fs";
import path from "path";
import { Page } from "playwright";
import { ApiJob, fetchLinkedInJobsAiHr } from "./jobs-ai-hr";

const OUTPUT_DIR = process.env.OUTPUT_DIR || "output";

function asTxt(jobs: ApiJob[]): string {
  return jobs
    .map((job, index) => {
      return [
        `#${index + 1}`,
        `Title: ${job.jobTitle}`,
        `Company: ${job.company}`,
        `Link: ${job.link}`,
        `Posting Date: ${job.postingDate || ""}`,
        `Description: ${job.description}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

export async function searchJobsAndWriteTxt(page: Page): Promise<{ jobs: ApiJob[]; txtPath: string; jsonPath: string }> {
  const jobs = await fetchLinkedInJobsAiHr(page);

  await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const txtPath = path.join(OUTPUT_DIR, `linkedin-jobs-${stamp}.txt`);
  const jsonPath = path.join(OUTPUT_DIR, `linkedin-jobs-${stamp}.json`);

  await fs.promises.writeFile(txtPath, asTxt(jobs), "utf8");
  await fs.promises.writeFile(jsonPath, JSON.stringify(jobs, null, 2), "utf8");

  return { jobs, txtPath, jsonPath };
}
