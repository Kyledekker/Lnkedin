import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { runWithLinkedInSession } from "../reuse-session";
import { fetchLinkedInJobsAiHr } from "../jobs-ai-hr";

export async function runJobsAiHr(_request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const startedAt = Date.now();
  context.log("runJobsAiHr trigger started");

  try {
    const jobs = await runWithLinkedInSession((page) => fetchLinkedInJobsAiHr(page));

    return {
      status: 200,
      jsonBody: {
        ok: true,
        count: jobs.length,
        tookMs: Date.now() - startedAt,
        jobs,
      },
    };
  } catch (error: any) {
    const message = String(error?.message ?? error);
    const status = message.includes("AUTH_REQUIRED") || message.includes("SESSION_MISSING") ? 401 : 500;

    return {
      status,
      jsonBody: {
        ok: false,
        error: message,
      },
    };
  }
}

app.http("runJobsAiHr", {
  methods: ["GET", "POST"],
  authLevel: "function",
  handler: runJobsAiHr,
});
