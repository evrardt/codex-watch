import { readFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';
import { alertText } from './alert-content.mjs';

// FCM HTTP v1; credentials stay on the bridge. Only a bounded title and result excerpt are sent.
export class Push {
  constructor(config, env = process.env, fetcher = fetch) { this.config = config; this.env = env; this.fetcher = fetcher; }
  get enabled() { return !!(this.config?.enabled === true && this.config.projectId && this.env.GOOGLE_APPLICATION_CREDENTIALS); }
  async accessToken() {
    if (this.cached && Date.now() < this.expiry) return this.cached;
    const key = JSON.parse(await readFile(this.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
    let form;
    if (key.type === 'authorized_user') {
      form = new URLSearchParams({grant_type:'refresh_token',client_id:key.client_id,client_secret:key.client_secret,refresh_token:key.refresh_token});
    } else {
    const now = Math.floor(Date.now() / 1000);
    const encode = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const unsigned = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode({ iss: key.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
    const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url');
    form = new URLSearchParams({ grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion:unsigned+'.'+signature });
    }
    const response = await this.fetcher('https://oauth2.googleapis.com/token', { method: 'POST',
      body:form, signal:AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Authentification FCM impossible');
    const result = await response.json();
    if (!result.access_token) throw new Error('Jeton FCM absent');
    this.cached = result.access_token; this.expiry = Date.now() + Math.max(0, Number(result.expires_in || 3600) - 60) * 1000;
    return this.cached;
  }
  async send(device, event) {
    if (!this.enabled) return;
    const response = await this.fetcher(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.config.projectId)}/messages:send`, {
      method: 'POST', headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token: device.token,
        data: { eventId:event.id, type:event.type, threadId:event.threadId, kind:event.kind, profile:device.profile || 'pc',
          title:alertText(event.title, 240, false), preview:alertText(event.preview, 1600), target:event.target==='requests'?'requests':'' },
        android: { priority:'high', ttl:'86400s' } } }), signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      if (result.error?.details?.some(d => d.errorCode === 'UNREGISTERED')) return { invalid:true };
      if (response.status === 401) this.cached = null;
      throw new Error('Envoi FCM indisponible (HTTP ' + response.status + ')');
    }
    return { delivered:true };
  }
}
