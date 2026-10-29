import type { RosterAuthConfig } from './native-roster';

/** Native clients can retain their current issuer during a website/MCP migration. */
export function nativeAuthConfig(env: Record<string, string | undefined> = process.env): RosterAuthConfig {
  const domain = env.NATIVE_AUTH0_DOMAIN || env.AUTH0_DOMAIN;
  const clientId = env.NATIVE_ROSTER_CLIENT_ID;
  const audience = env.NATIVE_ROSTER_RESOURCE_URL;
  if (!domain || !clientId || audience !== 'https://system.thearcades.me/native-host') throw new Error('Unavailable');
  const issuer = `https://${domain.replace(/^https?:\/\//, '').replace(/\/$/, '')}/`;
  return { issuer, clientId, audience, jwksUri: new URL('.well-known/jwks.json', issuer) };
}
