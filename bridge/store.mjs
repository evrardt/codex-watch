import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export class Store {
  data = { events: [], chats: [], devices: [], watched: [], watchedChatgpt:[], operations: {}, pushJobs:[] };
  queue = Promise.resolve();
  constructor(file) { this.file = file; }
  async load() {
    try { this.data = { ...this.data, ...JSON.parse(await readFile(this.file, 'utf8')) }; }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    // An interrupted send must never be automatically replayed (duplicate task / API billing).
    for (const op of Object.values(this.data.operations)) if (op.state === 'pending') op.state = 'unknown';
    for (const chat of this.data.chats) if (chat.status === 'active') chat.status = 'interrupted';
  }
  save() {
    const snapshot = JSON.stringify(this.data);
    this.queue = this.queue.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeFile(this.file + '.tmp', snapshot, { mode: 0o600 });
      await rename(this.file + '.tmp', this.file);
    });
    return this.queue;
  }
}
