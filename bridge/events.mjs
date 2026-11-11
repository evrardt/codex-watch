// Authenticated SSE; no prompts, answers or credentials are sent in alerts.
const publicEvent = e => ({ id:e.id, type:e.type, threadId:e.threadId, kind:e.kind, at:e.at });
export function openEventStream(req, res, service) {
  const cursor = req.headers['last-event-id'];
  if (cursor && (typeof cursor !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(cursor))) {
    res.writeHead(400); res.end(JSON.stringify({error:'Curseur invalide'})); return;
  }
  res.writeHead(200, { 'Content-Type':'text/event-stream; charset=utf-8', 'Cache-Control':'no-store',
    'Connection':'keep-alive', 'X-Accel-Buffering':'no' });
  res.flushHeaders(); req.socket.setTimeout(0);
  const sent = new Set();
  const send = event => {
    if (sent.has(event.id)) return;
    sent.add(event.id);
    if (sent.size > 1000) sent.delete(sent.values().next().value);
    // Close slow readers; their next connection replays from the last saved cursor.
    if (res.writableLength > 65536) { res.destroy(); return; }
    res.write('event: task\ndata: ' + JSON.stringify(publicEvent(event)) + '\n\n');
  };
  const close = () => { clearInterval(heartbeat); service.alerts.off('event', send); service.alerts.off('close', end); };
  const end = () => res.end();
  service.alerts.on('event', send); service.alerts.once('close', end);
  const history = service.store.data.events;
  if (cursor) {
    const index = history.findIndex(e => e.id === cursor);
    for (const event of history.slice(index < 0 ? 0 : index + 1)) send(event);
  }
  // A first connection establishes a baseline; reconnects catch up before checkpointing.
  res.write('event: checkpoint\ndata: ' + JSON.stringify({ cursor:history.at(-1)?.id || 'origin' }) + '\n\n');
  const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 60000);
  res.on('close', close); res.on('error', close);
}
