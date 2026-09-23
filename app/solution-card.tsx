'use client';
import {useEffect,useState} from 'react';
import {Check,Download,PackageCheck,ArrowRight,LoaderCircle} from 'lucide-react';
import type {SolutionPlan} from '@/lib/solutions';
import {money,dataTime} from './product-ui';

function reportText(plan:SolutionPlan){
 const parts=['ЭКТ · Отчёт о подборе',plan.goal,'Проверено: '+dataTime(plan.createdAt),plan.report.assessment];
 for(const o of plan.options){parts.push('\n'+o.title+(plan.selectedKey===o.key?' — ВЫБРАН':'')+' · '+money(o.total),o.summary);for(const i of o.items)parts.push(`${i.quantity} × ${i.product.name} (${i.product.manufacturerSku||i.product.sku}) — ${money(i.subtotal)}`,i.reason,...i.evidence.map(e=>e.label+': '+e.value),'Источник: '+i.product.url+' · '+dataTime(i.product.checkedAt));parts.push(...o.tradeoffs);}
 for(const [title,values] of [['Допущения',plan.report.assumptions],['Не включено / не подтверждено',plan.report.exclusions],['Следующие шаги',plan.report.nextSteps]] as const){if(values.length)parts.push('\n'+title,...values.map(v=>'• '+v));}
 parts.push('\n'+plan.scope,'Валюта ₸ — допущение: API не подтверждает валюту, единицу продажи и НДС.','Тестовая корзина. Заказ и резерв в ekt.kz не создаются.');return parts.join('\n');
}
export function SolutionCard({plan,busy,onSelect,receipt=false}:{plan:SolutionPlan;busy:boolean;onSelect:(id:string,key:'budget'|'extended')=>void;receipt?:boolean}){
 const [now,setNow]=useState(()=>Date.now());useEffect(()=>{const id=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(id);},[]);
 const expired=Date.parse(plan.expiresAt)<=now,active=plan.status==='pending'&&!expired&&!receipt;
 const options=receipt?plan.options.filter(o=>o.key===plan.selectedKey):plan.options;
 function download(){const url=URL.createObjectURL(new Blob(['\uFEFF'+reportText(plan)],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='ekt-selection-'+plan.id.slice(0,8)+'.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <section className="solution-plan" aria-label={receipt?'Отчёт выбранного комплекта':'Варианты решения'}>
  <div className="solution-heading"><PackageCheck size={20}/><span>{receipt?'Ваш выбранный комплект':'Решение вашей задачи'}</span></div>
  <p className="solution-goal">{plan.goal}</p>
  <div className="solution-options">{options.map((o,index)=><article className={'solution-option '+(plan.selectedKey===o.key?'is-selected':'')} key={o.key}>
   <div className="solution-tag">{plan.selectedKey===o.key?<><Check size={14}/>Выбран и добавлен</>:plan.options.length===1?'Подтверждённый вариант':index===0?'01 · Бюджетный':'02 · Более дорогой'}</div>
   <h3>{o.title}</h3><p>{o.summary}</p>
   <ol className="solution-items">{o.items.map(i=><li key={i.product.id}><div><b>{i.product.name}</b><span>{i.quantity} × {money(i.product.price)}</span></div><small>Арт. {i.product.manufacturerSku||i.product.sku} · проверено {dataTime(i.product.checkedAt)}</small><p>{i.reason}</p>{i.evidence.length>0&&<dl>{i.evidence.map((e,j)=><div key={j}><dt>{e.label}</dt><dd>{e.value}</dd></div>)}</dl>}<a href={i.product.url} target="_blank" rel="noreferrer">Карточка ekt.kz ↗</a></li>)}</ol>
   {o.tradeoffs.length>0&&<ul className="solution-tradeoffs">{o.tradeoffs.map((t,j)=><li key={j}>{t}</li>)}</ul>}
   <div className="solution-total"><span>Весь комплект · {o.items.reduce((sum,i)=>sum+i.quantity,0)} ед.</span><strong>{money(o.total)}</strong></div>
   {!receipt&&<button className="primary solution-select" disabled={!active||busy} onClick={()=>onSelect(plan.id,o.key)}>{busy?<LoaderCircle size={16} className="spin"/>:<ArrowRight size={16}/>}Выбрать и добавить комплект</button>}
  </article>)}</div>
  {!receipt&&<p className="solution-status">{plan.status==='applied'?'Выбранный комплект уже добавлен. Повторное добавление отключено.':plan.status==='superseded'?'Этот подбор заменён более новым.':expired||plan.status==='expired'?'Подбор устарел. Попросите помощника обновить варианты.':'Выбор добавит весь набор в тестовую корзину. Цены и остатки проверим ещё раз. Предложение действует 15 минут.'}</p>}
  <details className="solution-report" open={receipt}><summary>Почему выбраны эти товары</summary><p>{plan.report.assessment}</p>{[['Допущения',plan.report.assumptions],['Что не подтверждено или исключено',plan.report.exclusions],['Следующие шаги',plan.report.nextSteps]].map(([title,items])=>(items as string[]).length>0&&<div key={title as string}><h4>{title}</h4><ul>{(items as string[]).map((v,i)=><li key={i}>{v}</li>)}</ul></div>)}<p>{plan.scope}</p><button className="secondary" onClick={download}><Download size={15}/>Скачать полный отчёт</button></details>
  <small className="solution-footnote">₸ — допущение; валюта, единица продажи и НДС не подтверждены API. Корзина не оформляет заказ в магазине.</small>
 </section>;
}
