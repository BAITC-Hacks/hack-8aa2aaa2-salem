import {demoStock,propertyNames,searchProducts,type Product} from './catalog.ts';

export type Requirement={id:string;label:string;query:string;quantity:number;constraints:{key:string;value:string}[]};
export type SolutionDraft={goal:string;requirements:Requirement[];options:{key:'budget'|'extended';title:string;summary:string;tradeoffs:string[];items:{id:string;requirementId:string;reason:string;evidenceKeys:string[]}[]}[];report:{assessment:string;assumptions:string[];exclusions:string[];nextSteps:string[]}};
export type SolutionItem={product:Product;quantity:number;requirementId:string;reason:string;evidence:{label:string;value:string}[];subtotal:number};
export type SolutionPlan={id:string;goal:string;requirements:Requirement[];options:{key:'budget'|'extended';title:string;summary:string;tradeoffs:string[];items:SolutionItem[];total:number}[];report:SolutionDraft['report'];createdAt:string;expiresAt:string;status:'pending'|'applied'|'superseded'|'expired';selectedKey?:string;scope:string};
const string=(v:unknown,max=600)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const list=(v:unknown,max=8)=>Array.isArray(v)&&v.length<=max&&v.every(x=>string(x));
const same=(v:string)=>v.toLowerCase().replace(/\s/g,'').replaceAll(',','.').replaceAll('a','а').replaceAll('v','в');
export function validateRequirements(value:unknown):Requirement[]{
 if(!Array.isArray(value)||value.length<1||value.length>6)throw Error('Укажите от 1 до 6 обязательных позиций.');
 const ids=new Set<string>();
 for(const r of value){if(!object(r)||!string(r.id,30)||ids.has(r.id as string)||!string(r.label,160)||!string(r.query,160)||!Number.isSafeInteger(r.quantity)||Number(r.quantity)<1||Number(r.quantity)>100000||!Array.isArray(r.constraints)||r.constraints.length>8)throw Error('Некорректная потребность или количество.');ids.add(r.id as string);
  for(const c of r.constraints)if(!object(c)||typeof c.key!=='string'||!(c.key in propertyNames)||!string(c.value,100))throw Error('Используйте известные ключи характеристик и точные значения.');
 }
 return value as Requirement[];
}
export function validateSolutionDraft(value:unknown):SolutionDraft{
 if(!object(value)||!string(value.goal,1000))throw Error('Опишите задачу клиента.');const requirements=validateRequirements(value.requirements);
 if(!Array.isArray(value.options)||value.options.length<1||value.options.length>2)throw Error('Нужны один или два обоснованных варианта.');
 const keys=new Set<string>();
 for(const o of value.options){if(!object(o)||!['budget','extended'].includes(String(o.key))||keys.has(String(o.key))||!string(o.title,100)||!string(o.summary,1000)||!list(o.tradeoffs)||!Array.isArray(o.items)||o.items.length!==requirements.length)throw Error('Каждый вариант должен покрывать все обязательные позиции.');keys.add(String(o.key));const seen=new Set<string>(),ids=new Set<string>();
  for(const item of o.items){if(!object(item)||typeof item.id!=='string'||!/^\d{1,12}$/.test(item.id)||ids.has(item.id)||!requirements.some(r=>r.id===item.requirementId)||seen.has(String(item.requirementId))||!string(item.reason,800)||!Array.isArray(item.evidenceKeys)||item.evidenceKeys.length>8||!item.evidenceKeys.every(k=>typeof k==='string'&&k in propertyNames))throw Error('Проверьте состав, назначение и обоснование каждой позиции.');seen.add(String(item.requirementId));ids.add(item.id);}
 }
 const report=value.report;if(!object(report)||!string(report.assessment,1200)||!list(report.assumptions)||!list(report.exclusions)||!list(report.nextSteps))throw Error('Нужен отчёт: оценка задачи, допущения, исключения и следующие шаги.');
 return value as SolutionDraft;
}
export function meetsRequirements(p:Product,r:Requirement){return r.constraints.every(c=>{const a=p.attributes.find(a=>a.key===c.key);return !!a&&same(a.value)===same(c.value);});}
export function searchSolutionCandidates(products:Product[],query:string){
 const tokens=query.toLowerCase().split(/[^\p{L}\p{N}-]+/u).filter(Boolean);
 const exact=products.filter(p=>[p.id,p.sku,p.manufacturerSku].some(v=>v&&tokens.includes(v.toLowerCase())));
 return exact.length?exact:searchProducts(products,query);
}
export function ensureSelectable(p:Product,quantity:number){if(p.conflict||p.stockConflict||p.hasOffers||p.price===null||p.price<=0||demoStock(p)<quantity)throw Error('Товар '+(p.manufacturerSku||p.sku)+' нельзя включить: проверьте цену, варианты, расхождения и остаток.');}
export function buildSolutionPlan(draft:SolutionDraft,products:Map<string,Product>,now=Date.now()):SolutionPlan{
 validateSolutionDraft(draft);
 const options=draft.options.map(o=>({...o,items:o.items.map(item=>{const p=products.get(item.id),r=draft.requirements.find(r=>r.id===item.requirementId)!;if(!p)throw Error('Товар не прошёл проверку API.');ensureSelectable(p,r.quantity);if(!meetsRequirements(p,r))throw Error('Товар '+p.sku+' не соответствует ограничениям: '+r.constraints.filter(c=>!meetsRequirements(p,{...r,constraints:[c]})).map(c=>c.key+': запрошено «'+c.value+'», API «'+(p.attributes.find(a=>a.key===c.key)?.value??'нет данных')+'»').join('; '));for(const key of item.evidenceKeys)if(!p.attributes.some(a=>a.key===key))throw Error('Обоснование ссылается на отсутствующую характеристику.');return {product:p,quantity:r.quantity,requirementId:r.id,reason:item.reason,evidence:item.evidenceKeys.map(key=>{const a=p.attributes.find(a=>a.key===key)!;return {label:a.label,value:a.value};}),subtotal:Math.round(p.price!*r.quantity*100)/100};}),total:0}));
 for(const o of options)o.total=Math.round(o.items.reduce((sum,i)=>sum+i.subtotal,0)*100)/100;
 options.sort((a,b)=>a.total-b.total);if(options.length===1)options[0].key='budget';if(options.length===2){if(JSON.stringify(options[0].items.map(i=>i.product.id).sort())===JSON.stringify(options[1].items.map(i=>i.product.id).sort()))throw Error('Не создавайте два одинаковых варианта.');options[0].key='budget';options[1].key='extended';}
 return {id:crypto.randomUUID(),goal:draft.goal,requirements:draft.requirements,options,report:draft.report,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+15*60000).toISOString(),status:'pending',scope:'Подбор в загруженной выборке EKT. Бюджетный — дешевле среди показанных проверенных комплектов, не гарантия минимальной цены во всём магазине. Более дорогой не означает более подходящий.'};
}
export function parseSolutionChoice(text:string):'budget'|'extended'|null{
 const t=text.trim().toLowerCase().replace(/[.!]+$/,'').replace(/\s+/g,' ');
 if(/^(?:выбираю|беру|добавь|добавьте) (?:бюджетный(?: вариант| комплект)?|(?:вариант|комплект) (?:1|один|первый)|первый(?: вариант| комплект)?)(?: в корзину)?$/.test(t))return 'budget';
 if(/^(?:выбираю|беру|добавь|добавьте) (?:(?:расширенный|дорогой|более дорогой)(?: вариант| комплект)?|(?:вариант|комплект) (?:2|два|второй)|второй(?: вариант| комплект)?)(?: в корзину)?$/.test(t))return 'extended';return null;
}
