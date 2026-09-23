export type ConversationStatus='active'|'completed';
export type TurnOutcome='needs_input'|'complete';

export function isAffirmative(text:string){return /^(?:да|да,?\s+(?:добавь|добавляй|подтверждаю)|подтверждаю|добавляй|согласен|согласна|иә|қос)[.!\s]*$/iu.test(text.trim());}
// A model can resolve a reference, but cannot turn a question, condition or refusal into permission.
export function permitsCartSelection(text:string,hasImmediateOffer:boolean){
 const t=text.trim();
 if(/\?|(?:^|\s)(?:не|нет|нельзя|если|пока|потом|возможно|может|как|почему|зачем|что значит|не надо|жоқ)(?:\s|[,!.]|$)/iu.test(t))return false;
 if(isAffirmative(t))return hasImmediateOffer;
 return /(?:^|\s)(?:добавь(?:те)?|добавляй(?:те)?|положи(?:те)?|выбираю|беру|возьму|таңдаймын|қосыңыз)(?:\s|$)/iu.test(t);
}
export function permitsCartEdit(text:string,quantity:number){
 if(/[?]|(?:^|\s)(?:не|нет|если|пока|потом|как|почему)(?:\s|[,!.]|$)/iu.test(text))return false;
 if(quantity===0)return /(?:^|\s)(?:удали(?:те)?|убери(?:те)?|убрать|удалить|алып таста)(?:\s|$)/iu.test(text);
 return /(?:^|\s)(?:измени(?:те)?|поставь(?:те)?|оставь(?:те)?|сделай(?:те)?|установи(?:те)?)(?:\s|$)/iu.test(text)&&new RegExp(`(?:^|\\s)${quantity}(?:\\s|$|[.,!])`).test(text);
}
export function matchesOptionChoice(text:string,key:string,keys:string[]){
 if(keys.length===1)return keys[0]===key;
 const budget=/(?:бюджет|дешев|дешёв|первый|первого|вариант\s*1|комплект\s*1)/iu.test(text);
 const extended=/(?:расшир|дорог|второй|второго|вариант\s*2|комплект\s*2)/iu.test(text);
 return budget!==extended&&(budget?key==='budget':key==='extended');
}
export function matchesCartTarget(text:string,id:string,items:{product:{id:string;sku:string;manufacturerSku?:string|null}}[],context:string|null){
 const mentioned=items.filter(i=>[i.product.id,i.product.sku,i.product.manufacturerSku].filter(Boolean).some(value=>text.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).includes(value!.toLowerCase())));
 if(mentioned.length)return mentioned.length===1&&mentioned[0].product.id===id;
 if(items.length===1)return items[0].product.id===id;
 return /(?:^|\s)(?:его|этот|эту|этого)(?:\s|$)/iu.test(text)&&context===id;
}
// Suggestions help supply missing facts; optional rewrites are not another task.
export function usefulSuggestions<T extends {label:string;text:string}>(suggestions:T[],outcome:TurnOutcome):T[]{
 if(outcome==='complete')return [];
 return suggestions.filter(s=>!/(?:покороче|подлиннее|короче|подробнее|сократ|расшир|перефраз|больше текста|безопаснее|более безопасн)/iu.test(s.label+' '+s.text));
}
