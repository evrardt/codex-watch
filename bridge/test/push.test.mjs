import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Push } from '../push.mjs';

test('FCM uses data-only high-priority alerts so the watch controls the chat-opening intent', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'codexwatch-push-'));
  t.after(async () => { assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep)); await rm(dir, {recursive:true,force:true}); });
  const {privateKey} = generateKeyPairSync('rsa', {modulusLength:2048});
  const keyFile = path.join(dir, 'key.json');
  await writeFile(keyFile, JSON.stringify({client_email:'test@example.invalid',private_key:privateKey.export({type:'pkcs8',format:'pem'})}));
  const calls = [];
  const push = new Push({enabled:true,projectId:'test-project'}, {GOOGLE_APPLICATION_CREDENTIALS:keyFile}, async (url, options) => {
    calls.push({url,options});
    return {ok:true,json:async () => url.includes('oauth2') ? {access_token:'test-token'} : {name:'accepted'}};
  });
  const event = {id:'event',threadId:'same-chat',type:'completed',kind:'codex',title:'Nom de la tâche',preview:'La mise à jour est installée.'};
  await push.send({token:'device',profile:'pc'},event); await push.send({token:'device',profile:'pc'},event);
  const payload = JSON.parse(calls[1].options.body);
  assert.equal(payload.message.notification, undefined);
  assert.equal(payload.message.android.priority, 'high');
  assert.equal(payload.message.data.threadId, 'same-chat');
  assert.equal(payload.message.data.type, 'completed');
  assert.equal(payload.message.data.title, event.title);
  assert.equal(payload.message.data.preview, event.preview);
  assert.ok(Buffer.byteLength(JSON.stringify(payload.message)) < 4096);
  assert.equal(calls.filter(c => c.url.includes('oauth2')).length, 1);
  push.fetcher = async () => ({ok:false,status:404,json:async () => ({error:{details:[{errorCode:'UNREGISTERED'}]}})});
  assert.deepEqual(await push.send({token:'device'},event), {invalid:true});
});

test('a public Firebase app configuration alone cannot enable a sender', () => {
  assert.equal(new Push({projectId:'test'}, {GOOGLE_APPLICATION_CREDENTIALS:'old-unrelated-credential'}).enabled, false);
});

test('existing Google OAuth credentials refresh without creating a service-account key', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'codexwatch-push-'));
  t.after(async () => { assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep)); await rm(dir, {recursive:true,force:true}); });
  const file = path.join(dir, 'oauth.json');
  await writeFile(file, JSON.stringify({type:'authorized_user',client_id:'test-client',client_secret:'test-secret',refresh_token:'test-refresh'}));
  let grant;
  const push = new Push({enabled:true,projectId:'test'}, {GOOGLE_APPLICATION_CREDENTIALS:file}, async (_url, options) => {
    grant = options.body;
    return {ok:true,json:async () => ({access_token:'temporary-test-token',expires_in:3600})};
  });
  assert.equal(await push.accessToken(), 'temporary-test-token');
  assert.equal(grant.get('grant_type'), 'refresh_token');
  assert.equal(grant.get('assertion'), null);
});
