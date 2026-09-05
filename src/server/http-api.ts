import { NextResponse } from "next/server";
import { uuidSchema } from "@/domain/contracts";
import { requireOwnerId } from "@/server/auth";
import { normalizeSystemError, SystemError } from "@/server/system-error";

export async function apiOwner(request: Request) {
  try { return await requireOwnerId(request); } catch (error) { throw normalizeSystemError(error); }
}

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const allowed = new Set([new URL(request.url).origin]);
  if (process.env.SYSTEM_PUBLIC_ORIGIN) allowed.add(new URL(process.env.SYSTEM_PUBLIC_ORIGIN).origin);
  if (!allowed.has(origin)) throw new SystemError("UNAUTHORIZED", "Cross-origin mutations are not allowed.");
}

export function idempotencyKey(request: Request) {
  const key = request.headers.get("idempotency-key");
  if (!key) throw new SystemError("VALIDATION_ERROR", "Idempotency-Key is required for mutations.");
  const result = uuidSchema.safeParse(key);
  if (!result.success) throw new SystemError("VALIDATION_ERROR", "Idempotency-Key must be a UUID.");
  return result.data;
}

export async function jsonBody(request: Request) {
  try { return await request.json() as Record<string, unknown>; } catch { throw new SystemError("VALIDATION_ERROR", "The request body must be valid JSON."); }
}

export function mutationMeta(requestId: string, replayed: boolean) {
  return { requestId, replayed };
}

export async function apiResponse(run: () => Promise<Response>) {
  try { return await run(); } catch (raw) {
    const error = normalizeSystemError(raw);
    if (!(error instanceof SystemError)) {
      console.error("[api] request failed", { code: "INTERNAL_ERROR" });
      return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "The server could not complete the request." } }, { status: 500 });
    }
    const status = { VALIDATION_ERROR: 400, NOT_FOUND: 404, CONFLICT: 409, ERASURE_BLOCKED: 409, UNAUTHORIZED: 401, FORBIDDEN: 403, RATE_LIMITED: 429, QUOTA_EXCEEDED: 413 }[error.code];
    return NextResponse.json({ error: { code: error.code, message: error.userMessage, details: error.details } }, { status, headers: error.code === "RATE_LIMITED" ? {"Retry-After":"60"} : undefined });
  }
}

export function parseBoolean(value: string | null) { return value === "true"; }
export function parseLimit(value: string | null) { return value ? Number(value) : undefined; }
export function splitValues(value: string | null) { return value ? value.split(",").filter(Boolean) : undefined; }
