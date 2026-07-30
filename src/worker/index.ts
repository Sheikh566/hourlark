import { Hono } from "hono";

import type { AppContext } from "@/domain/types";
import { errorResponse } from "@/worker/errors";
import { authenticationMiddleware } from "@/worker/middleware/authentication";
import { csrfMiddleware } from "@/worker/middleware/csrf";
import { requestIdMiddleware } from "@/worker/middleware/request-id";
import { api } from "@/worker/routes/api";

const app = new Hono<AppContext>();

app.use("/api/*", requestIdMiddleware);
app.use("/api/v1/*", authenticationMiddleware);
app.use("/api/v1/*", csrfMiddleware);
app.route("/api/v1", api);

app.notFound((c) =>
  c.json(
    {
      error: {
        code: "not_found",
        message: "API route not found.",
        request_id: c.get("requestId") || crypto.randomUUID(),
      },
    },
    404,
  ),
);

app.onError((error, c) => errorResponse(c, error));

export default app;
