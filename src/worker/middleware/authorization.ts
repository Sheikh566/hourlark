import { createMiddleware } from "hono/factory";

import type { Action } from "@/domain/permissions/policy";
import { can } from "@/domain/permissions/policy";
import type { AppContext } from "@/domain/types";
import { ApiError } from "@/worker/errors";

export function requirePermission(action: Action) {
  return createMiddleware<AppContext>(async (c, next) => {
    if (!can(c.get("member").role, action)) {
      throw new ApiError(403, "permission_denied", "You do not have permission for this action.");
    }
    await next();
  });
}
