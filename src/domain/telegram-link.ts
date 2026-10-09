/** Stable browser contract for self-service Telegram linking. */
export type TelegramLinkState = "disconnected" | "awaiting_confirmation" | "connected" | "bot_access_required" | "disabled";
export type TelegramBotAccess = "granted" | "missing" | "unknown";
export type TelegramConnectionMetadata = {
  displayName: string | null;
  username: string | null;
  connectedAt: string;
  revision: number;
};
export type TelegramPendingConfirmation = {
  confirmationId: string;
  displayName: string | null;
  username: string | null;
  expiresAt: string;
};
export type TelegramLinkStatus = {
  state: TelegramLinkState;
  connection?: TelegramConnectionMetadata;
  pending?: TelegramPendingConfirmation;
  botAccess?: TelegramBotAccess;
  /** Only returned after bot identity has been verified against OIDC configuration. */
  botStartUrl?: string;
};
export type TelegramLinkStartRequest = { intent?: string | null };
export type TelegramLinkStartResponse = { authorizationUrl: string; expiresAt: string; state?: undefined } | { state: "disabled" };
export type TelegramLinkConfirmRequest = { confirmationId: string };
export type TelegramLinkConfirmResponse = TelegramLinkStatus & {
  state: "connected" | "bot_access_required";
  connection: TelegramConnectionMetadata;
  botAccess: "granted" | "missing";
};
export type TelegramLinkErrorCode =
  | "unauthenticated" | "not_eligible" | "disabled" | "invalid_request" | "csrf_failed"
  | "transaction_expired" | "transaction_replayed" | "session_mismatch" | "confirmation_expired"
  | "telegram_account_conflict" | "telegram_identity_invalid" | "bot_access_required"
  | "rate_limited" | "temporarily_unavailable";
export type TelegramLinkError = { error: { code: TelegramLinkErrorCode; message: string } };

/** Server-only configuration names; values must never cross the API boundary. */
export const TELEGRAM_LINK_ENV = {
  botToken: "TELEGRAM_BOT_TOKEN",
  oidcClientId: "TELEGRAM_OIDC_CLIENT_ID",
  oidcClientSecret: "TELEGRAM_OIDC_CLIENT_SECRET",
} as const;
