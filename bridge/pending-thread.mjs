const milliseconds=value=>{
  if(typeof value==='number'&&Number.isFinite(value))return value<1e12?value*1000:value;
  if(typeof value==='string'&&value)return Date.parse(value)||0;
  return 0;
};

/** Match an initial request with its verified full content and creation time. */
export function matchesPendingThread(thread, prompt, submittedAt) {
  if(!thread || thread.historyStale || typeof prompt!=='string' || !prompt.trim())return false;
  const turns=[...(thread.turns||[])].sort((a,b)=>milliseconds(a.startedAt)-milliseconds(b.startedAt));
  const first=turns[0];if(!first)return false;
  const at=milliseconds(first.startedAt)||milliseconds(thread.createdAt);
  if(!at||at<submittedAt-5000||at>submittedAt+120000)return false;
  const firstUser=turns.flatMap(t=>t.items||[]).find(i=>i.type==='userMessage');
  const actual=firstUser?(firstUser.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n'):(thread.kind==='chatgpt'?null:thread.preview);
  return typeof actual==='string'&&actual.trim()===prompt.trim();
}

export function recentPendingCandidate(candidate, submittedAt) {
  const at=milliseconds(candidate.updatedAt);
  return !at||at>=submittedAt-5000;
}

/** Only use the recent list if its oldest unpinned item predates the request. */
export function completeRecentCandidates(list,kind,project,submittedAt){
  if(!Array.isArray(list?.threads)||!Array.isArray(list?.pinnedThreads)||!list.threads.length)return null;
  const oldest=milliseconds(list.threads.at(-1)?.updatedAt);
  if(!oldest||oldest>=submittedAt-5000)return null;
  const unique=new Map();
  for(const item of [...list.pinnedThreads,...list.threads]){
    if(item?.id&&item.kind===kind&&(item.projectId||'')===(project||'')&&recentPendingCandidate(item,submittedAt))unique.set(item.id,item);
  }
  return [...unique.values()];
}
