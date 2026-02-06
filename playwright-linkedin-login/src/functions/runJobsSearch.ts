import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { runWithLinkedInSession } from "../reuse-session";
import { searchJobsAndWriteTxt } from "../jobs-search";

export async function runJobsSearch(_request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const startedAt = Date.now();
  context.log("runJobsSearch trigger started");

  try {
    const result = await runWithLinkedInSession((page) => searchJobsAndWriteTxt(page));

    return {
      status: 200,
      jsonBody: {
        ok: true,
        count: result.jobs.length,
        txtPath: result.txtPath,
        jsonPath: result.jsonPath,
        tookMs: Date.now() - startedAt,
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

app.http("runJobsSearch", {
  methods: ["GET", "POST"],
  authLevel: "function",
  handler: runJobsSearch,
});
