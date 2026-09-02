import { ZodError } from "zod";

export type SystemErrorCode = "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "ERASURE_BLOCKED" | "UNAUTHORIZED";

export class SystemError extends Error {
  constructor(public readonly code: SystemErrorCode, public readonly userMessage: string, public readonly details?: Record<string, unknown>) {
    super(`${code}: ${userMessage}`);
    this.name = "SystemError";
  }
}

export function normalizeSystemError(error: unknown) {
  if (error instanceof SystemError) return error;
  if (error instanceof ZodError) return new SystemError("VALIDATION_ERROR", "The request did not match the contract.", { issues: error.issues });
  if (error instanceof Error && error.message.includes("Sign in with Google")) return new SystemError("UNAUTHORIZED", error.message);
  return error;
}
