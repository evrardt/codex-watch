import test from 'node:test';
import assert from 'node:assert/strict';
import { importConversations } from '../import-chatgpt.mjs';

test('import follows the current branch and excludes tools and hidden content', () => {
  const node = (id, parent, role, text, extra = {}) => ({ id, parent, message: { id, author: { role }, content: { parts: [text, { image: 'ignored' }] }, ...extra } });
  const conversation = { id: 'original-1', title: 'Exemple', current_node: 'answer', mapping: {
    root: node('root', null, 'system', 'hidden'), user: node('user', 'root', 'user', 'Bonjour'),
    alternative: node('alternative', 'user', 'assistant', 'Not the selected branch'),
    tool: node('tool', 'user', 'assistant', 'Tool arguments', { recipient: 'python' }),
    hidden: node('hidden', 'tool', 'assistant', 'Hidden', { metadata: { is_visually_hidden_from_conversation: true } }),
    answer: node('answer', 'hidden', 'assistant', 'Salut') } };
  const [chat] = importConversations([conversation]);
  assert.deepEqual(chat.messages.map(m => m.text), ['Bonjour', 'Salut']);
  assert.equal(chat.source, 'chatgpt-export');
  assert.equal(importConversations([conversation])[0].id, chat.id);
});
test('invalid entries are ignored; cycles cannot loop forever', () => {
  assert.deepEqual(importConversations([{ mapping: {} }, {}]), []);
  assert.throws(() => importConversations({}), /tableau/);
  const c = { id: 'cycle', current_node: 'a', mapping: { a: { parent: 'a', message: { author: { role: 'user' }, content: { parts: ['Safe'] } } } } };
  assert.equal(importConversations([c])[0].messages.length, 1);
});
