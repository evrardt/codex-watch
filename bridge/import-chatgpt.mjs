import { createHash } from 'node:crypto';

// Local, one-way import of a user-provided ChatGPT conversations.json export.
// Follow the selected branch; never concatenate alternate conversation branches.
export function importConversations(conversations) {
  if (!Array.isArray(conversations)) throw new Error('Un tableau conversations.json est attendu');
  return conversations.flatMap(conversation => {
    const mapping = conversation.mapping;
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return [];
    let current = conversation.current_node;
    if (!mapping[current]) {
      current = Object.values(mapping).filter(n => !n.children?.length).sort((a, b) => (b.message?.create_time || 0) - (a.message?.create_time || 0))[0]?.id;
    }
    const branch = [], seen = new Set();
    while (current && mapping[current] && !seen.has(current)) {
      seen.add(current); branch.push(mapping[current]); current = mapping[current].parent;
    }
    const messages = branch.reverse().flatMap(node => {
      const m = node.message;
      if (!m || !['user', 'assistant'].includes(m.author?.role) || (m.recipient && m.recipient !== 'all') || m.metadata?.is_visually_hidden_from_conversation) return [];
      const text = m.content?.parts?.filter(p => typeof p === 'string').join('\n').trim();
      return text ? [{ id: m.id || node.id, role: m.author.role, text }] : [];
    });
    if (!messages.length) return [];
    const externalId = conversation.id || conversation.conversation_id;
    const digest = createHash('sha256').update(String(externalId || JSON.stringify(messages))).digest('hex').slice(0, 32);
    return [{ id: 'import-' + digest, kind: 'chat', source: 'chatgpt-export', title: conversation.title || 'Conversation importée',
      updatedAt: conversation.update_time || conversation.create_time || 0, status: 'idle', messages }];
  });
}
