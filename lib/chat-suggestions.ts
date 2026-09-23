export type ChatSuggestion={label:string;text:string;kind:'fill'|'reply'};
const fields=(text:string)=>[...text.matchAll(/\[[^\]\n]{1,80}\]/g)];
const assistantVoice=(text:string)=>/^(?:како[йеяв]|сколько|где|есть ли).*(?:у вас|вам|ваш)|^(?:укажите|уточните|напишите|сообщите|пришлите|опишите)(?:\s|:|$)|^(?:какая|какой|какое)\s+(?:маркировка|номинал|бюджет|количество)|^(?:қандай|қанша).*сіз/iu.test(text.trim());
export function validateSuggestions(value:unknown):ChatSuggestion[]{
 if(!Array.isArray(value)||value.length>3)throw Error('Use up to three customer reply suggestions.');
 const labels=new Set<string>();
 for(const x of value){if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!['label','text','kind'].includes(k))||typeof x.label!=='string'||!x.label.trim()||x.label.length>64||labels.has(x.label)||typeof x.text!=='string'||!x.text.trim()||x.text.length>240||!['fill','reply'].includes(x.kind))throw Error('Suggestion requires a unique label (64 chars), text (240 chars) and kind fill/reply.');
  if(assistantVoice(x.text))throw Error('Write the CUSTOMER reply, never repeat your question. Example: label «Указать маркировку», text «Маркировка: [надпись на корпусе]», kind fill.');
  if((x.kind==='fill')!==!!fields(x.text).length)throw Error('A fill suggestion needs a [field to complete]; a reply must contain no placeholders.');labels.add(x.label);
 }
 return value as ChatSuggestion[];
}
// Existing persisted string suggestions remain editable; old assistant questions are hidden.
export function readSuggestions(value:unknown):ChatSuggestion[]{
 if(!Array.isArray(value))return [];
 return value.slice(0,3).flatMap(x=>{if(typeof x==='string'){if(!x.trim()||x.length>240||assistantVoice(x))return [];return [{label:x,text:x,kind:fields(x).length?'fill':'reply'} as ChatSuggestion];}try{return validateSuggestions([x]);}catch{return [];}});
}
export function composeSuggestion(current:string,suggestion:ChatSuggestion,previous?:ChatSuggestion|null){
 // Replace only an untouched inserted draft. Never overwrite anything the customer edited.
 const text=current.includes(suggestion.text)?current:previous&&current.includes(previous.text)?current.replace(previous.text,suggestion.text):current.trim()?current.trimEnd()+'\n'+suggestion.text:suggestion.text;
 if(text.length>2000)throw Error('В поле уже много текста. Сократите его, чтобы добавить подсказку.');
 const matches=fields(text),first=matches[0];return {text,start:first?.index??text.length,end:first?first.index!+first[0].length:text.length,placeholders:matches.map(m=>m[0])};
}
export function hasUnfilledFields(text:string,placeholders:string[]){return placeholders.some(p=>text.includes(p));}
