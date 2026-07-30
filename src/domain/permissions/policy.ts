import type { AuthenticatedMember, Role } from "@/domain/types";

export const actions = [
  "timer:own",
  "entry:create-own",
  "entry:edit-own",
  "entry:delete-own",
  "entry:view-team",
  "entry:edit-team",
  "report:view-own",
  "report:view-team",
  "report:view-financial",
  "report:export",
  "client:view-safe",
  "client:manage",
  "project:view-safe",
  "project:manage",
  "tag:manage",
  "member:view",
  "member:manage-role",
  "member:manage-status",
  "member:reset-binding",
  "settings:manage",
  "audit:view",
  "lock:override",
] as const;

export type Action = (typeof actions)[number];

const grants: Record<Role, ReadonlySet<Action>> = {
  member: new Set([
    "timer:own",
    "entry:create-own",
    "entry:edit-own",
    "entry:delete-own",
    "report:view-own",
    "client:view-safe",
    "project:view-safe",
  ]),
  manager: new Set([
    "timer:own",
    "entry:create-own",
    "entry:edit-own",
    "entry:delete-own",
    "entry:view-team",
    "entry:edit-team",
    "report:view-own",
    "report:view-team",
    "report:view-financial",
    "report:export",
    "client:view-safe",
    "client:manage",
    "project:view-safe",
    "project:manage",
    "tag:manage",
    "member:view",
  ]),
  admin: new Set(actions),
};

export function can(role: Role, action: Action): boolean {
  return grants[role].has(action);
}

export function canEditEntry(member: AuthenticatedMember, ownerId: string): boolean {
  return ownerId === member.id
    ? can(member.role, "entry:edit-own")
    : can(member.role, "entry:edit-team");
}

export function canViewMemberTime(member: AuthenticatedMember, ownerId: string): boolean {
  return ownerId === member.id || can(member.role, "entry:view-team");
}

export function hasFinancialAccess(role: Role): boolean {
  return can(role, "report:view-financial");
}
