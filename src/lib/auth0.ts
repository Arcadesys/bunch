import { Auth0Client } from "@auth0/nextjs-auth0/server";

let client: Auth0Client | undefined;

export function isAuth0Configured() {
  return Boolean(
    process.env.AUTH0_DOMAIN
      && process.env.AUTH0_CLIENT_ID
      && process.env.AUTH0_CLIENT_SECRET
      && process.env.AUTH0_SECRET,
  );
}

export function getAuth0Client() {
  if (!isAuth0Configured()) throw new Error("Auth0 is not configured.");
  client ??= new Auth0Client({
    enableAccessTokenEndpoint: false,
    authorizationParameters: { connection: "google-oauth2", scope: "openid profile email" },
  });
  return client;
}
