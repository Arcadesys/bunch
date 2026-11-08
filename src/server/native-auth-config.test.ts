import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeAuthConfig } from './native-auth-config';
const base = { AUTH0_DOMAIN: 'new.example', NATIVE_ROSTER_CLIENT_ID: 'native-client', NATIVE_ROSTER_RESOURCE_URL: 'https://system.thearcades.me/native-host' };
test('native verifier uses its explicitly configured old issuer, independently of web issuer', () => {
 const result = nativeAuthConfig({...base, NATIVE_AUTH0_DOMAIN:'old.example'});
 assert.equal(result.issuer,'https://old.example/');
 assert.equal(result.jwksUri.href,'https://old.example/.well-known/jwks.json');
 assert.equal(result.clientId,'native-client');
});
test('without override native verifier retains existing issuer behavior', () => {
 assert.equal(nativeAuthConfig(base).issuer,'https://new.example/');
});
test('native verifier rejects missing client or wrong audience', () => {
 assert.throws(()=>nativeAuthConfig({...base,NATIVE_ROSTER_CLIENT_ID:''}));
 assert.throws(()=>nativeAuthConfig({...base,NATIVE_ROSTER_RESOURCE_URL:'https://wrong.example/'}));
});

test('native override accepts only the pinned issuer and client', async () => {
 const { generateKeyPair, SignJWT } = await import('jose');
 const { verifyRosterToken } = await import('./native-roster');
 const {publicKey,privateKey} = await generateKeyPair('RS256');
 const config = nativeAuthConfig({...base, NATIVE_AUTH0_DOMAIN:'old.example'});
 async function token(issuer: string, client: string) {
  return new SignJWT({scope:'bunch:roster.read', azp:client}).setProtectedHeader({alg:'RS256'}).setIssuer(issuer).setAudience(config.audience).setSubject('synthetic').setExpirationTime('5m').sign(privateKey);
 }
 assert.equal(await verifyRosterToken(await token('https://old.example/','native-client'),config,async()=>publicKey),'auth0:synthetic');
 await assert.rejects(()=>token('https://new.example/','native-client').then(t=>verifyRosterToken(t,config,async()=>publicKey)));
 await assert.rejects(()=>token('https://old.example/','other-client').then(t=>verifyRosterToken(t,config,async()=>publicKey)));
});
