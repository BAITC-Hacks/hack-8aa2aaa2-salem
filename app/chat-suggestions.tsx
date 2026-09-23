'use client';
import {PencilLine,MessageSquareText} from 'lucide-react';
import {readSuggestions,type ChatSuggestion} from '@/lib/chat-suggestions';
export function ChatSuggestions({value,disabled,onChoose}:{value:unknown;disabled:boolean;onChoose:(suggestion:ChatSuggestion)=>void}){
 const suggestions=readSuggestions(value);if(!suggestions.length)return null;
 return <div className="reply-suggestions"><span>Помочь с ответом</span><div className="suggestions agent-suggestions">{suggestions.map((s,i)=><button type="button" key={s.label+i} disabled={disabled} onClick={()=>onChoose(s)} title="Вставить в поле сообщения"><span>{s.label}</span>{s.kind==='fill'?<PencilLine size={15}/>:<MessageSquareText size={15}/>}</button>)}</div><small>Подсказка заполнит поле. Отправляете вы.</small></div>;
}
