import type { Context } from "hono";

import type { AppContext } from "@/domain/types";

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function errorResponse(c: Context<AppContext>, error: unknown): Response {
  const requestId = c.get("requestId") || crypto.randomUUID();
  if (error instanceof ApiError) {
    return c.json(
      {
        error: {
          code: error.code,
          message: error.message,
          request_id: requestId,
          ...error.details,
        },
      },
      error.status,
    );
  }

  console.error(
    JSON.stringify({
      message: "unhandled request error",
      request_id: requestId,
      path: c.req.path,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  return c.json(
    {
      error: {
        code: "internal_error",
        message: "An unexpected error occurred.",
        request_id: requestId,
      },
    },
    500,
  );
}
