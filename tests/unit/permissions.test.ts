import { actions, can } from "@/domain/permissions/policy";
import type { Role } from "@/domain/types";
import { describe, expect, it } from "vitest";

const memberActions = new Set([
  "timer:own",
  "entry:create-own",
  "entry:edit-own",
  "entry:delete-own",
  "report:view-own",
  "client:view-safe",
  "project:view-safe",
]);
const managerOnlyActions = new Set([
  "entry:view-team",
  "entry:edit-team",
  "report:view-team",
  "report:view-financial",
  "report:export",
  "client:manage",
  "project:manage",
  "tag:manage",
  "member:view",
]);

describe("permission policy", () => {
  it.each<Role>(["member", "manager", "admin"])("matches the complete %s action matrix", (role) => {
    for (const action of actions) {
      const expected =
        role === "admin" ||
        memberActions.has(action) ||
        (role === "manager" && managerOnlyActions.has(action));
      expect(can(role, action), `${role}:${action}`).toBe(expected);
    }
  });

  it("does not let a manager mutate roles, bindings, settings, or locks", () => {
    expect(can("manager", "member:manage-role")).toBe(false);
    expect(can("manager", "member:reset-binding")).toBe(false);
    expect(can("manager", "settings:manage")).toBe(false);
    expect(can("manager", "lock:override")).toBe(false);
  });
});
