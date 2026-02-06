declare module "@azure/functions" {
  export interface HttpRequest {
    method: string;
    url: string;
  }

  export interface InvocationContext {
    log(...args: unknown[]): void;
  }

  export interface HttpResponseInit {
    status?: number;
    headers?: Record<string, string>;
    body?: string;
    jsonBody?: unknown;
  }

  export const app: {
    http(
      name: string,
      config: {
        methods: string[];
        authLevel?: "anonymous" | "function" | "admin";
        handler: (request: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit> | HttpResponseInit;
      }
    ): void;
  };
}
