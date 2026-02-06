import dotenv from "dotenv";
import { runWithLinkedInSession } from "./src/reuse-session";
import { searchJobsAndWriteTxt } from "./src/jobs-search";

dotenv.config();

async function main() {
  console.log("♻️ Reusing saved LinkedIn session...");
  const result = await runWithLinkedInSession((page) => searchJobsAndWriteTxt(page));

  console.log(`✅ Jobs fetched: ${result.jobs.length}`);
  console.log(`📄 TXT written: ${result.txtPath}`);
  console.log(`📄 JSON written: ${result.jsonPath}`);
}

main().catch((err: any) => {
  console.error("❌ Failed during session reuse / job search.");
  console.error(err?.message ?? err);
  process.exit(1);
});
