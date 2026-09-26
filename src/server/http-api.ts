// Shared route plumbing: derive the owner from the session, reject cross-origin
// mutations, and render every failure through one error shape so routes cannot leak
// internal messages piecemeal.

import { NextResponse } from "next/server";
import { uuidSchema } from "@/domain/contracts";
import { requireOwnerId } from "@/server/auth";
import { normalizeSystemError, SystemError, systemErrorStatus } from "@/server/system-error";

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
  try {
    const response = await run();
    if (!response.headers.has("Cache-Control")) response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (raw) {
    const error = normalizeSystemError(raw);
    if (!(error instanceof SystemError)) {
      console.error("[api] request failed", {
        code: "INTERNAL_ERROR",
        name: error instanceof Error ? error.name : typeof error,
        pgCode: error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : undefined,
        message: (error instanceof Error ? error.message : String(error)).slice(0, 300),
      });
      return NextResponse.json(
        { error: { code: "INTERNAL_ERROR", message: "The server could not complete the request." } },
        { status: 500, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const headers = new Headers({ "Cache-Control": "private, no-store" });
    if (error.code === "RATE_LIMITED") headers.set("Retry-After", "60");
    return NextResponse.json(
      { error: { code: error.code, message: error.userMessage, details: error.details } },
      { status: systemErrorStatus(error), headers },
    );
  }
}

export function parseBoolean(value: string | null) { return value === "true"; }
export function parseLimit(value: string | null) { return value ? Number(value) : undefined; }
export function splitValues(value: string | null) { return value ? value.split(",").filter(Boolean) : undefined; }
