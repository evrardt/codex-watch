import test from 'node:test';
import assert from 'node:assert/strict';
import { alertContent, alertText } from '../alert-content.mjs';

test('alerts use the current final answer and title, excluding commentary and tool outputs', () => {
  const thread = {name:'Corriger les notifications', turns:[{items:[{type:'agentMessage',text:'Ancienne réponse'}]},
    {items:[{type:'agentMessage',phase:'commentary',text:'En cours'}, {type:'reasoning',text:'Privé'},
      {type:'commandExecution',output:'Sortie privée'}, {type:'agentMessage',phase:'final_answer',text:'**Installé** : [voir le résultat](https://example.invalid).'}]}]};
  assert.deepEqual(alertContent(thread, 'completed'), {title:'Corriger les notifications',preview:'Installé : voir le résultat.'});
  thread.turns.at(-1).items.pop();
  assert.equal(alertContent(thread, 'completed').preview, '');
  thread.turns.at(-1).error = {message:'Connexion indisponible'};
  assert.equal(alertContent(thread, 'failed').preview, 'Connexion indisponible');
  assert.equal(alertContent(thread, 'interrupted').preview, '');
});

test('long Unicode titles and results fit the FCM payload without splitting emoji', () => {
  const content = alertContent({name:'🛠️'.repeat(1000),turns:[{items:[{type:'agentMessage',text:'🧑‍💻 résultat '.repeat(2000)}]}]}, 'completed');
  assert.ok(Buffer.byteLength(content.title) <= 240);
  assert.ok(Buffer.byteLength(content.preview) <= 1600);
  assert.ok(!/[\uD800-\uDBFF]$/.test(content.preview));
  assert.ok(content.preview.endsWith('…'));
  assert.equal(alertText('Petit résultat', 1600), 'Petit résultat');
  assert.equal(alertContent({name:'C# / snake_case',turns:[]}, 'completed').title, 'C# / snake_case');
});
