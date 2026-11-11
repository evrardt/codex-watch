// Bound UTF-8 bytes, including emoji, to keep the whole FCM data payload below 4 KiB.
export function alertText(value, maxBytes, stripMarkdown = true) {
  let text = String(value || '');
  if (stripMarkdown) text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_#>]/g, '');
  text = text.replace(/\s+/g, ' ').trim();
  if (Buffer.byteLength(text) <= maxBytes) return text;
  let result = '', bytes = 0;
  for (const char of text) {
    const size = Buffer.byteLength(char);
    if (bytes + size > maxBytes - 3) break;
    result += char; bytes += size;
  }
  return result.trimEnd() + '…';
}

export function alertContent(thread, type, kind = 'codex') {
  const turn = thread.turns?.at(-1);
  const localChat = kind === 'chat' || (kind === 'chatgpt' && Array.isArray(thread.messages));
  const messages = localChat ? thread.messages || [] : (turn?.items || [])
    .filter(item => item.type === 'agentMessage').map(item => ({ role:'assistant', ...item }));
  // Never use an earlier turn's answer, commentary, tool output or internal reasoning.
  const final = messages.findLast(item => item.role === 'assistant' && (!item.phase || item.phase === 'final_answer'));
  const error = localChat ? thread.error : turn?.error?.message;
  return { title:alertText(thread.name || thread.title || thread.preview || 'Conversation Codex', 240, false),
    preview:alertText(type === 'failed' ? error : type === 'completed' ? final?.text : '', 1600) };
}
