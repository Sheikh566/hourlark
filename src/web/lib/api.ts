import type { ApiErrorPayload } from "@/web/types";

let csrfToken: string | null = null;

export const DEVELOPMENT_IDENTITIES = [
  { email: "sheikh.abdullah@iomechs.com", label: "Administrator" },
  { email: "manager@iomechs.com", label: "Manager" },
  { email: "member@iomechs.com", label: "Member" },
] as const;

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly details?: ApiErrorPayload["error"],
  ) {
    super(message);
  }
}

export function setCsrfToken(value: string): void {
  csrfToken = value;
}

export function getDevelopmentIdentity(): string | null {
  if (!import.meta.env.DEV) return null;
  return localStorage.getItem("iomechs.dev-user");
}

export function setDevelopmentIdentity(email: string): void {
  if (!import.meta.env.DEV) {
    throw new Error("Development identity switching is disabled in production.");
  }
  localStorage.setItem("iomechs.dev-user", email.trim().toLowerCase());
  window.location.reload();
}

export function clearDevelopmentIdentity(): void {
  if (!import.meta.env.DEV) {
    throw new Error("Development identity switching is disabled in production.");
  }
  localStorage.removeItem("iomechs.dev-user");
  window.location.reload();
}

async function parseError(response: Response): Promise<never> {
  let payload: ApiErrorPayload | null = null;
  try {
    payload = (await response.json()) as ApiErrorPayload;
  } catch {
    // The safe fallback below intentionally hides non-JSON server content.
  }
  throw new ApiClientError(
    response.status,
    payload?.error.code ?? "request_failed",
    payload?.error.message ?? "The request failed.",
    payload?.error.request_id,
    payload?.error,
  );
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  const devIdentity = getDevelopmentIdentity();
  if (devIdentity) headers.set("X-Dev-User-Email", devIdentity);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (init.method && !["GET", "HEAD"].includes(init.method.toUpperCase()) && csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  const response = await fetch(`/api/v1${path}`, { ...init, headers });
  if (!response.ok) return parseError(response);
  return (await response.json()) as T;
}

export async function apiDownload(
  path: string,
  body: unknown,
  fallbackName: string,
): Promise<void> {
  const headers = new Headers({ "Content-Type": "application/json", Accept: "*/*" });
  const devIdentity = getDevelopmentIdentity();
  if (devIdentity) headers.set("X-Dev-User-Email", devIdentity);
  if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(`/api/v1${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) return parseError(response);
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition");
  const name = disposition?.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function idempotencyKey(): string {
  return crypto.randomUUID();
}
