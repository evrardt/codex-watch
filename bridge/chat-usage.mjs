// Estimate for VPS Chat only. This is not the OpenAI invoice or a spending cap.
const rates={'gpt-6-luna':[0.1,0.5],'gpt-6.1-terra':[1,5],'gpt-6.1-sol':[2,10]};
export function recordChatUsage(store,model,usage,now=new Date()){
 const month=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit'}).format(now);
 store.data.chatUsage ||= {};const item=store.data.chatUsage[month] ||= {estimatedUsd:0,calls:0,unknown:0};item.calls++;
 const rate=rates[model];if(!rate||!Number.isSafeInteger(usage?.input_tokens)||!Number.isSafeInteger(usage?.output_tokens)||usage.input_tokens<0||usage.output_tokens<0){item.unknown++;return;}
 item.estimatedUsd+=(usage.input_tokens*rate[0]+usage.output_tokens*rate[1])/1e6;
}
export function chatUsageStatus(store,now=new Date()){
 const month=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit'}).format(now);
 return {month,...(store.data.chatUsage?.[month]||{estimatedUsd:0,calls:0,unknown:0})};
}
