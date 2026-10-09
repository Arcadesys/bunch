import { NextResponse } from "next/server";
import type { PrivateImageRead } from "./private-images";

const privateMediaCacheControl = "private, no-cache, max-age=0, must-revalidate";
const noStoreCacheControl = "private, no-store";
const vercelNoStore = "no-store";

function matchesIfModifiedSince(request: Request, lastModified?: Date) {
  if (!lastModified) return false;
  const value = request.headers.get("if-modified-since");
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && lastModified.getTime() <= parsed + 999;
}

function matchesIfNoneMatch(request: Request, etag?: string) {
  if (!etag) return false;
  return (request.headers.get("if-none-match") ?? "").split(",").some((candidate) => {
    const normalized = candidate.trim();
    return normalized === "*" || normalized === etag || normalized === `W/${etag}`;
  });
}

export type PrivateMediaResponseOptions = {
  cache?: "private" | "no-store";
  contentDisposition?: string;
  crossOriginResourcePolicy?: string;
  allowConditional?: boolean;
};

export function privateMediaResponse(request: Request, media: PrivateImageRead, options: PrivateMediaResponseOptions = {}) {
  const allowConditional = options.allowConditional !== false && options.cache !== "no-store";
  const hasIfNoneMatch = request.headers.has("if-none-match");
  const requestMatches = hasIfNoneMatch
    ? matchesIfNoneMatch(request, media.etag)
    : matchesIfModifiedSince(request, media.lastModified);
  const notModified = allowConditional && (media.notModified || requestMatches);
  const headers = new Headers({
    "Cache-Control": options.cache === "no-store" ? noStoreCacheControl : privateMediaCacheControl,
    "Vercel-CDN-Cache-Control": vercelNoStore,
    ...(notModified ? {} : { "Content-Type": media.contentType }),
    "X-Content-Type-Options": "nosniff",
  });
  if (options.contentDisposition) headers.set("Content-Disposition", options.contentDisposition);
  if (options.crossOriginResourcePolicy) headers.set("Cross-Origin-Resource-Policy", options.crossOriginResourcePolicy);
  if (media.etag) headers.set("ETag", media.etag);
  if (media.lastModified) headers.set("Last-Modified", media.lastModified.toUTCString());

  if (notModified) {
    return new NextResponse(null, { status: 304, headers });
  }
  return new NextResponse(media.body, { headers });
}

export function privateMediaError(message: string, status: number) {
  return new NextResponse(message, { status, headers: { "Cache-Control": noStoreCacheControl, "Vercel-CDN-Cache-Control": vercelNoStore } });
}
