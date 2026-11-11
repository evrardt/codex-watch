import test from 'node:test';import assert from 'node:assert/strict';import {recordChatUsage,chatUsageStatus} from '../chat-usage.mjs';
test('VPS Chat estimates known model usage and identifies missing usage separately',()=>{
 const store={data:{}},date=new Date('2026-11-10T12:00:00Z');recordChatUsage(store,'gpt-6.1-terra',{input_tokens:1000000,output_tokens:1000000},date);
 recordChatUsage(store,'unknown',{input_tokens:1,output_tokens:1},date);recordChatUsage(store,'gpt-6-luna',null,date);
 const status=chatUsageStatus(store,date);assert.equal(status.month,'2026-11');assert.equal(status.estimatedUsd,6);assert.equal(status.calls,3);assert.equal(status.unknown,2);
});
