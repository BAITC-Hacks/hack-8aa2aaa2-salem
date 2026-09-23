import {validateRequirements,validateSolutionDraft,buildSolutionPlan,searchSolutionCandidates,meetsRequirements,ensureSelectable,parseSolutionChoice,type Requirement,type SolutionPlan,type SolutionDraft} from './solutions';
import {env} from 'cloudflare:workers';
import {isAffirmative,permitsCartSelection,permitsCartEdit,matchesCartTarget,matchesOptionChoice,type ConversationStatus} from './conversation';
import {runAgent,type AgentReply} from './agent';
import {agentSearch} from './agent-search';
import seed from '@/data/catalog.json';
import {normalize,type Product,type RawProduct,validateQuantity,demoStock,matchingAlternatives,tokenMatches,mergeCatalogSnapshots} from './catalog';

export class ApiError extends Error {constructor(public status:number, public code:string,message:string){super(message);}}
export const db=()=>{if(!env.DB)throw new ApiError(503,'STORAGE_UNAVAILABLE','Хранилище временно недоступно. Попробуйте позже.');return env.DB;};
export const json=(data:unknown,status=200,headers:Record<string,string>={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
export function checkOrigin(req:Request){const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)throw new ApiError(403,'INVALID_ORIGIN','Запрос разрешён только с этого сайта.');}
export async function body(req:Request){if(!req.headers.get('content-type')?.includes('application/json'))throw new ApiError(415,'INVALID_CONTENT_TYPE','Ожидается JSON.');const txt=await req.text();if(txt.length>12000)throw new ApiError(413,'BODY_TOO_LARGE','Слишком длинный запрос.');try{const parsed=JSON.parse(txt);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error();return parsed;}catch{throw new ApiError(400,'INVALID_JSON','Ожидается объект JSON.');}}
export async function session(req:Request){const id=req.headers.get('cookie')?.match(/(?:^|;\s*)ekt_session=([a-f0-9-]{36})/)?.[1];if(!id)throw new ApiError(401,'SESSION_REQUIRED','Обновите страницу, чтобы начать сессию.');const row=await db().prepare('SELECT * FROM sessions WHERE id=? AND expires>?').bind(id,Date.now()).first<{id:string;last_product:string|null}>();if(!row)throw new ApiError(401,'SESSION_EXPIRED','Сессия завершена. Обновите страницу.');return row;}
export async function bootstrap(req:Request){await cleanupExpired();let id:string;try{id=(await session(req)).id;}catch(e){if(!(e instanceof ApiError)||e.status!==401)throw e;id=crypto.randomUUID();await db().prepare('INSERT INTO sessions(id,created,expires) VALUES(?,?,?)').bind(id,Date.now(),Date.now()+7*86400000).run();}const rows=await db().prepare('SELECT role,content_json FROM messages WHERE session_id=? ORDER BY created DESC,rowid DESC LIMIT 40').bind(id).all<{role:string;content_json:string}>();return json({conversationStatus:await conversationStatus(id),cart:await getCart(id),messages:await hydrateSolutions(id,rows.results.reverse().map(r=>({role:r.role,...JSON.parse(r.content_json)}))),mode:env.OPENAI_API_KEY?'agent':'catalog',catalog:await getCatalog()},200,{'Set-Cookie':`ekt_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${new URL(req.url).protocol==='https:'?'; Secure':''}`});}
export async function ekt(path:string){if(!env.EKT_API_USER||!env.EKT_API_PASSWORD)throw new ApiError(503,'EKT_NOT_CONFIGURED','Доступ к каталогу не настроен.');let response:Response;try{response=await fetch(`${import.meta.env.DEV && env.EKT_LOCAL_API_BASE === 'http://127.0.0.1:5173/__ekt-local-api/' ? env.EKT_LOCAL_API_BASE : 'https://ekt.kz/api/'}${path}`,{headers:{Authorization:'Basic '+btoa(env.EKT_API_USER+':'+env.EKT_API_PASSWORD),Accept:'application/json'},signal:AbortSignal.timeout(12000),redirect:'manual'});}catch(e){console.error('EKT transport',e instanceof Error?e.message:'unknown');throw new ApiError(503,'EKT_UNAVAILABLE','Не удалось обновить данные ekt.kz. Попробуйте ещё раз.');}if(!response.ok)throw new ApiError(response.status===404?404:503,'EKT_UNAVAILABLE','Каталог ekt.kz временно недоступен или товар не найден.');try{return await response.json() as Record<string,unknown>;}catch{throw new ApiError(503,'INVALID_UPSTREAM','Каталог вернул некорректный ответ.');}}
export async function getCatalog(){
 const pages=await db().prepare('SELECT page,payload,updated FROM catalog_pages ORDER BY page').all<{page:number;payload:string;updated:number}>();
 const details=await db().prepare('SELECT payload,updated FROM product_details').all<{payload:string;updated:number}>();
 const snapshots=[{items:seed.items as RawProduct[],updated:Date.parse(seed.syncedAt)},...pages.results.map(p=>({items:JSON.parse(p.payload).items as RawProduct[],updated:p.updated})),...details.results.map(p=>({items:[JSON.parse(p.payload)] as RawProduct[],updated:p.updated}))];
 const last=Math.max(seed.pages,...pages.results.map(p=>p.page)),lastPage=pages.results.find(p=>p.page===last);
 return {items:mergeCatalogSnapshots(snapshots),pages:last,complete:lastPage?JSON.parse(lastPage.payload).items.length===0:false,syncedAt:new Date(Math.max(...snapshots.map(s=>s.updated))).toISOString()};
}
export async function loadNextPage(){const catalog=await getCatalog();if(catalog.complete)return catalog;const next=catalog.pages+1;if(next>3000)throw new ApiError(422,'PAGE_LIMIT','Достигнут лимит загрузки прототипа.');const raw=await ekt(`products?page=${next}`);if(!Array.isArray(raw.items)||Number(raw.page)!==next)throw new ApiError(503,'INVALID_PAGE','API не подтвердил запрошенную страницу.');await db().prepare('INSERT INTO catalog_pages(page,payload,updated) VALUES(?,?,?) ON CONFLICT(page) DO UPDATE SET payload=excluded.payload,updated=excluded.updated').bind(next,JSON.stringify(raw),Date.now()).run();return getCatalog();}
export async function detail(id:string){if(!/^\d{1,12}$/.test(id))throw new ApiError(400,'INVALID_PRODUCT','Некорректный идентификатор товара.');const raw=await ekt(`products/detail?id=${id}`) as unknown as RawProduct;if(String(raw.id)!==id||typeof raw.name!=='string'||!raw.name.trim())throw new ApiError(503,'INVALID_PRODUCT_DATA','В карточке товара отсутствуют обязательные данные.');await db().prepare('INSERT INTO product_details(id,payload,updated) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated=excluded.updated').bind(id,JSON.stringify(raw),Date.now()).run();const checkedAt=new Date().toISOString();return {...normalize(raw,checkedAt),checkedAt};}
export async function getCart(sid:string){const rows=await db().prepare('SELECT product_json,quantity FROM cart WHERE session_id=?').bind(sid).all<{product_json:string;quantity:number}>();const items=rows.results.map(r=>({product:JSON.parse(r.product_json) as Product,quantity:r.quantity}));return {mode:'demo',items,total:Math.round(items.reduce((s,r)=>s+(r.product.price??0)*r.quantity,0)*100)/100,itemCount:items.reduce((s,r)=>s+r.quantity,0),url:'/?view=cart'};}
export async function propose(sid:string,productId:string,qty:unknown){let quantity:number;try{quantity=validateQuantity(qty);}catch(e){throw new ApiError(422,'INVALID_QUANTITY',(e as Error).message);}const p=await detail(productId);if(p.price===null||p.price===0)throw new ApiError(409,'PRICE_UNCONFIRMED','Цена не подтверждена. Уточните её у магазина.');if(p.stockConflict)throw new ApiError(409,'STOCK_CONFLICT','Общий остаток и сумма складов расходятся. Уточните наличие у магазина.');if(p.conflict)throw new ApiError(409,'DATA_CONFLICT',p.conflictText);if(p.hasOffers)throw new ApiError(422,'VARIANT_REQUIRED','У товара есть варианты. Выберите исполнение на ekt.kz.');const existing=await db().prepare('SELECT quantity FROM cart WHERE session_id=? AND product_id=?').bind(sid,productId).first<{quantity:number}>();if(quantity+(existing?.quantity??0)>demoStock(p))throw new ApiError(409,'INSUFFICIENT_STOCK',`Недостаточно остатка для тестовой корзины. Лимит тестовой корзины: ${demoStock(p)}; доступность отгрузки подтверждает магазин, в корзине уже ${existing?.quantity??0}.`);const id=crypto.randomUUID();const expires=Date.now()+5*60000;await db().prepare('INSERT INTO proposals(id,session_id,product_id,product_json,quantity,price,status,expires,created) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,sid,p.id,JSON.stringify(p),quantity,p.price,'pending',expires,Date.now()).run();return {id,product:p,quantity,total:Math.round(p.price*quantity*100)/100,expiresAt:new Date(expires).toISOString(),status:'pending'};}
export async function confirm(sid:string,id:string,explicit:unknown){if(explicit!==true)throw new ApiError(422,'CONFIRMATION_REQUIRED','Необходимо явное подтверждение добавления.');const prop=await db().prepare('SELECT * FROM proposals WHERE id=? AND session_id=?').bind(id,sid).first<{id:string;product_id:string;product_json:string;quantity:number;price:number;status:string;expires:number}>();if(!prop)throw new ApiError(404,'NOT_FOUND','Предложение не найдено.');if(prop.status==='applied')return singleReceipt(sid,prop,JSON.parse(prop.product_json),true);if(prop.status!=='pending'||prop.expires<Date.now())throw new ApiError(410,'PROPOSAL_EXPIRED','Предложение устарело. Выберите товар заново.');const p=await detail(prop.product_id);if(p.conflict||p.stockConflict||p.hasOffers||p.price===null||p.price<=0||p.price!==prop.price)throw new ApiError(409,'PROPOSAL_CHANGED','Данные товара изменились. Создайте новое предложение.');const limit=demoStock(p);const token=crypto.randomUUID();await db().batch([
 db().prepare("UPDATE proposals SET status='applied', operation_token=? WHERE id=? AND session_id=? AND status='pending' AND expires>? AND quantity+COALESCE((SELECT quantity FROM cart WHERE session_id=? AND product_id=?),0)<=?").bind(token,id,sid,Date.now(),sid,p.id,limit),
 db().prepare("INSERT INTO cart(session_id,product_id,product_json,quantity) SELECT session_id,product_id,?,quantity FROM proposals WHERE id=? AND session_id=? AND operation_token=? ON CONFLICT(session_id,product_id) DO UPDATE SET quantity=cart.quantity+excluded.quantity,product_json=excluded.product_json").bind(JSON.stringify(p),id,sid,token),
 db().prepare("UPDATE sessions SET conversation_status='completed',completed_at=? WHERE id=? AND EXISTS (SELECT 1 FROM proposals WHERE id=? AND session_id=? AND operation_token=?)").bind(Date.now(),sid,id,sid,token),
 db().prepare("INSERT INTO messages(id,session_id,role,content_json,created) SELECT ?,session_id,'assistant',?,? FROM proposals WHERE id=? AND session_id=? AND operation_token=?").bind(crypto.randomUUID(),JSON.stringify(singleMessage(prop,p,false)),Date.now(),id,sid,token)
 ]);const applied=await db().prepare('SELECT status,operation_token FROM proposals WHERE id=? AND session_id=?').bind(id,sid).first<{status:string;operation_token:string}>();if(applied?.status!=='applied')throw new ApiError(409,'INSUFFICIENT_STOCK','Остаток или корзина изменились. Выберите доступное количество заново.');return singleReceipt(sid,prop,p,applied.operation_token!==token);}
export async function removeCartItem(sid:string,id:string,explicit:unknown){if(explicit!==true)throw new ApiError(422,'CONFIRMATION_REQUIRED','Подтвердите удаление.');await db().prepare('DELETE FROM cart WHERE session_id=? AND product_id=?').bind(sid,id).run();return getCart(sid);}
export async function alternatives(id:string){const source=await detail(id);if(source.conflict)return {items:[],message:source.conflictText};const candidates=matchingAlternatives(source,(await getCatalog()).items);const fresh=await Promise.all(candidates.map(async p=>{try{return await detail(p.id);}catch{return null;}}));const items=matchingAlternatives(source,fresh.filter((p):p is NonNullable<typeof p>=>p!==null)).filter(p=>demoStock(p)>0);return {items,message:items.length?'Совпадают ток, число полюсов, напряжение и отключающая способность. Это кандидаты для проверки специалистом; монтаж и остальные параметры нужно сверить.':'В загруженной выборке нет проверенного кандидата с совпадением всех обязательных параметров. Нужны дополнительные данные или консультация менеджера.'};}
export async function saveMessage(sid:string,role:string,content:unknown){await db().prepare('INSERT INTO messages(id,session_id,role,content_json,created) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),sid,role,JSON.stringify(content),Date.now()).run();}
async function catalogChat(sid:string,text:unknown,contextId?:unknown){if(typeof text!=='string'||!text.trim()||text.length>2000)throw new ApiError(422,'INVALID_MESSAGE','Введите сообщение длиной до 2000 символов.');const t=text.trim();const catalog=await getCatalog();const sess=await db().prepare('SELECT last_product FROM sessions WHERE id=?').bind(sid).first<{last_product:string|null}>();const context=typeof contextId==='string'?contextId:sess?.last_product;const result:{text:string;products?:Product[];cartLink?:string;mode:string}={text:'',mode:'catalog'};
 if(/оплат|достав|минимальн|партия|самовывоз/i.test(t)){result.text='В предоставленном API нет утверждённых условий оплаты, доставки и минимальной партии. Не буду их предполагать. Уточните условия у менеджера на ekt.kz. Остатки по городам доступны в карточке товара.';}
 else if(/корзин|да[ ,]+добав|оформ|купить/i.test(t)){result.text='Это тестовая корзина: заказ в ekt.kz не создаётся. Откройте товар, укажите количество, нажмите «Подготовить добавление», затем подтвердите состав. Перед добавлением я повторно проверю цену и остаток. Для готового комплекта можно выбрать вариант кнопкой или написать «Выбираю бюджетный».';result.cartLink='/?view=cart';}
 else if(/сертификат/i.test(t)){result.text='В проверенных данных API ссылка на сертификат не предоставлена. Я не могу подтвердить наличие документа. Откройте страницу товара на ekt.kz или запросите сертификат у менеджера.';}
 else if(/аналог|замен/i.test(t)&&context){const r=await alternatives(context);result.text=r.message;result.products=r.items;}
 else {
 const stop=new Set(['найди','найти','нужен','нужна','нужно','нужны','мне','пожалуйста','проверить','проверь','артикул','арт','наличие','есть','ли','товар','товара','цена','сколько','стоит','покажи','характеристики','какой','какие','на','в','по','и','его','этого','об','этом','расскажи']);
 const tokens=t.toLowerCase().replace(/[?.,!;:]/g,' ').split(/\s+/).filter(w=>w&&!stop.has(w));
 const exact=catalog.items.filter(p=>[p.id,p.sku,p.manufacturerSku].filter(Boolean).some(v=>tokens.includes(v.toLowerCase())));
 const scored=catalog.items.map(p=>{const hay=`${p.name} ${p.sku} ${p.manufacturerSku} ${p.description}`.toLowerCase();return {p,score:tokens.reduce((n,w)=>n+(tokenMatches(hay,w)?1:0),0)};}).filter(x=>tokens.length>0&&x.score===tokens.length).map(x=>x.p);
 let matches=exact.length?exact:scored;
 if(!matches.length&&context&&!/\d/.test(t)&&tokens.every(w=>['наличии','наличие','характеристики','характеристика','расскажи','этот','этом','этого','товаре','нем','него','остаток','остатки'].includes(w)))matches=catalog.items.filter(p=>p.id===context);
 if(matches.length===1){const p=await detail(matches[0].id);await db().prepare('UPDATE sessions SET last_product=? WHERE id=?').bind(p.id,sid).run();result.products=[p];result.text=`${p.name}\nЦена по API: ${p.price===null?'не указана':p.price.toLocaleString('ru-RU')} (в прототипе — ₸). Общий остаток по API: ${p.quantity??'не указан'}.\n${p.conflict?p.conflictText:p.attributes.slice(0,6).map(a=>a.label+': '+a.value).join('\n')}\nДанные обновлены сейчас. Склады и подробности — в карточке.`;}
 else if(matches.length>1){result.products=matches.slice(0,4);result.text=`Нашёл ${matches.length} позиций в загруженной выборке. Уточните артикул или откройте подходящую карточку — проверю актуальные характеристики и остатки.`;}
 else {result.text=/привет|здравств|помощ|помочь|умеешь|можешь/i.test(t)?'Здравствуйте! Напишите артикул, например 027228, или название товара. Я найду позицию в каталоге и проверю её данные. Сейчас работаю в режиме поиска по каталогу, без языковой модели.':'В загруженной выборке точного совпадения нет. Попробуйте короткое название или артикул. Можно загрузить следующую страницу каталога. Для подбора аналога сначала откройте исходный товар.';}
 }
 await saveMessage(sid,'user',{text:t});await saveMessage(sid,'assistant',result);return result;
}





async function cleanupExpired(){const now=Date.now();await db().batch(['messages','proposals','cart','solutions'].map(table=>db().prepare('DELETE FROM '+table+' WHERE session_id IN (SELECT id FROM sessions WHERE expires<?)').bind(now)).concat([db().prepare('DELETE FROM sessions WHERE expires<?').bind(now),db().prepare('DELETE FROM agent_locks WHERE expires<?').bind(now)]));}



export async function chat(sid:string,text:unknown,contextId?:unknown){
 if(typeof text!=='string'||!text.trim()||text.length>2000)throw new ApiError(422,'INVALID_MESSAGE','Введите сообщение длиной до 2000 символов.');
 if(await conversationStatus(sid)==='completed')throw new ApiError(409,'CONVERSATION_COMPLETED','Задача завершена. Нажмите «Продолжить разговор», чтобы возобновить её.');
 const choice=parseSolutionChoice(text);
 if(choice){const last=await db().prepare('SELECT id FROM solutions WHERE session_id=? ORDER BY created DESC,rowid DESC LIMIT 1').bind(sid).first<{id:string}>();if(!last)return {text:'Сначала опишите задачу: подготовлю варианты с составом и ценой, затем вы сможете выбрать комплект.',mode:'agent',products:[],steps:[],suggestions:[]};await saveMessage(sid,'user',{text:text.trim()});return selectSolution(sid,last.id,choice,true);}
 if(!env.OPENAI_API_KEY)return catalogChat(sid,text,contextId);
 const now=Date.now(), token=crypto.randomUUID();
 const lock=await db().prepare('INSERT INTO agent_locks(session_id,token,expires) VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET token=excluded.token,expires=excluded.expires WHERE agent_locks.expires<? RETURNING token').bind(sid,token,now+120000,now).first<{token:string}>();
 if(!lock)throw new ApiError(409,'AGENT_BUSY','Предыдущее сообщение ещё обрабатывается. Дождитесь ответа.');
 try {
  const count=await db().prepare("SELECT COUNT(*) AS n FROM messages WHERE session_id=? AND role='user' AND created>?").bind(sid,now-3600000).first<{n:number}>();
  if((count?.n??0)>=60)throw new ApiError(429,'CHAT_LIMIT','Достигнут лимит 60 сообщений в час. Попробуйте позже.');
  const rows=await db().prepare('SELECT role,content_json FROM messages WHERE session_id=? ORDER BY created DESC,rowid DESC LIMIT 20').bind(sid).all<{role:string;content_json:string}>();
  const history=rows.results.reverse().map(r=>{const m=JSON.parse(r.content_json);return {role:r.role,content:JSON.stringify({text:m.text,solution:m.solution?{id:m.solution.id,goal:m.solution.goal,requirements:m.solution.requirements,options:m.solution.options.map((o:SolutionPlan['options'][number])=>({key:o.key,title:o.title,total:o.total,items:o.items.map(i=>({id:i.product.id,quantity:i.quantity}))})),expiresAt:m.solution.expiresAt}:undefined,products:m.products?.map((p:Product)=>({id:p.id,name:p.name,sku:p.sku})),proposal:m.proposal?{id:m.proposal.id,productId:m.proposal.product?.id,quantity:m.proposal.quantity,status:'Confirmation state must be checked using read_cart'}:undefined})};});
  const sess=await db().prepare('SELECT last_product FROM sessions WHERE id=?').bind(sid).first<{last_product:string|null}>();
  const context=typeof contextId==='string'&&/^\d{1,12}$/.test(contextId)?contextId:sess?.last_product??null;
  await saveMessage(sid,'user',{text:text.trim()});
  if(isAffirmative(text)){
   const pending=await db().prepare("SELECT id,product_json,quantity,price,expires FROM proposals WHERE session_id=? AND status='pending' AND expires>? ORDER BY created DESC LIMIT 1").bind(sid,Date.now()).first<{id:string;product_json:string;quantity:number;price:number;expires:number}>();
   const lastMessage=rows.results.at(-1);const offered=lastMessage?.role==='assistant'?JSON.parse(lastMessage.content_json).proposal?.id:undefined;
   if(pending&&offered===pending.id)return confirm(sid,pending.id,true);
  }
  const offeredMessages=rows.results.filter(r=>r.role==='assistant').map(r=>JSON.parse(r.content_json));
  const latestOffer=[...offeredMessages].reverse().find(m=>m.solution||m.proposal);
  const immediate=rows.results.at(-1);const lastReply=immediate?.role==='assistant'?JSON.parse(immediate.content_json):null;
  const canSelect=permitsCartSelection(text,!!(lastReply?.proposal||lastReply?.solution?.options?.length===1));
  const selections=await availableSelections(sid,latestOffer);
  history.push({role:'user',content:text.trim()});
  const memo=new Map<string,Product>();
  const fresh=async(id:string)=>{if(memo.has(id))return memo.get(id)!;const p=await detail(id);memo.set(id,p);return p;};
  const result=await runAgent({key:env.OPENAI_API_KEY,model:env.OPENAI_MODEL||'gpt-5.4-mini',history,context,services:{
   search:async args=>{const c=await getCatalog();return {...agentSearch(c.items,String(args.query),args.maxPrice as number|null,Boolean(args.inStock)),scope:c.complete?'full_catalog':'loaded_sample',catalogCount:c.items.length,fresh:false};},
   detail:fresh,alternatives,cart:async()=>({...await getCart(sid),availableSelections:selections,canApplySelection:canSelect}),
   applySelection:async(id,key)=>{if(!canSelect||!selections.some(s=>s.id===id&&s.optionKeys.includes(key)&&matchesOptionChoice(text,key,s.optionKeys)))throw new ApiError(422,'CHOICE_REQUIRED','Нужен явный выбор показанного клиенту товара или комплекта.');return key==='single'?confirm(sid,id,true):selectSolution(sid,id,key,true);},
   editCart:async(id,quantity)=>{if(!permitsCartEdit(text,quantity)||!matchesCartTarget(text,id,(await getCart(sid)).items,context))throw new ApiError(422,'EDIT_REQUEST_REQUIRED','Нужно прямое указание удалить позицию или установить конкретное количество.');return setCartQuantity(sid,id,quantity);},prepare:(id,quantity)=>propose(sid,id,quantity),findSolution:requirements=>findSolutionProducts(requirements),prepareSolution:draft=>prepareSolution(draft)
  }});
  if(result.cart)return result; // Mutation services persist their receipt and status atomically.
  if(result.products.length===1)await db().prepare('UPDATE sessions SET last_product=? WHERE id=?').bind(result.products[0].id,sid).run();
   if(result.solution){const plan=result.solution;await db().batch([
    db().prepare("UPDATE solutions SET status='superseded' WHERE session_id=? AND status='pending'").bind(sid),
    db().prepare('INSERT INTO solutions(id,session_id,payload,status,expires,created) VALUES(?,?,?,?,?,?)').bind(plan.id,sid,JSON.stringify(plan),'pending',Date.parse(plan.expiresAt),Date.parse(plan.createdAt)),
    db().prepare('INSERT INTO messages(id,session_id,role,content_json,created) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),sid,'assistant',JSON.stringify(result),Date.now())
   ]);}else await db().batch([db().prepare('INSERT INTO messages(id,session_id,role,content_json,created) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),sid,'assistant',JSON.stringify(result),Date.now()),db().prepare('UPDATE sessions SET conversation_status=?,completed_at=? WHERE id=?').bind(result.conversationStatus??'active',result.conversationStatus==='completed'?Date.now():null,sid)]);return result;
 }catch(e){
  if(e instanceof ApiError)throw e;
  const code=e instanceof Error?e.message:'AGENT_ERROR';
  console.error('Agent request failed',code.startsWith('AGENT_')?code:'AGENT_TRANSPORT');
  const text=code==='AGENT_RATE_LIMIT'?'ИИ временно достиг лимита запросов. Попробуйте через минуту.':code==='AGENT_QUOTA'?'Закончилась доступная квота ИИ. Каталог и карточки товаров продолжают работать.':'Не удалось завершить проверку. Попробуйте отправить запрос ещё раз. Корзина этим сообщением не изменена.';
  const result={text,mode:'unavailable',products:[],steps:[],suggestions:[]};
  await saveMessage(sid,'assistant',result);return result;
 }finally{await db().prepare('DELETE FROM agent_locks WHERE session_id=? AND token=?').bind(sid,token).run();}
}

async function hydrateSolutions(sid:string,messages:Record<string,unknown>[]){const rows=await db().prepare('SELECT id,status,selected_key,expires FROM solutions WHERE session_id=?').bind(sid).all<{id:string;status:SolutionPlan['status'];selected_key:string|null;expires:number}>();const states=new Map(rows.results.map(r=>[r.id,r]));return messages.map(m=>{const plan=m.solution as SolutionPlan|undefined;if(!plan)return m;const row=states.get(plan.id);return {...m,solution:{...plan,status:row?(row.status==='pending'&&row.expires<Date.now()?'expired':row.status):'superseded',selectedKey:row?.selected_key??undefined}};});}

export async function findSolutionProducts(value:Requirement[]){
 const requirements=validateRequirements(value),catalog=await getCatalog();const results=[];
 for(const r of requirements){
  const queryMatches=searchSolutionCandidates(catalog.items,r.query);
  const matches=queryMatches.filter(p=>!p.conflict&&!p.stockConflict&&(meetsRequirements(p,r)||!p.detailed)).sort((a,b)=>(a.price??Infinity)-(b.price??Infinity));
  const sample=[...new Map([...matches.slice(0,4),...matches.slice(-2)].map(p=>[p.id,p])).values()];
  const checked=await Promise.allSettled(sample.map(p=>detail(p.id)));
  const candidates=checked.flatMap(result=>{if(result.status==='rejected')return [];const p=result.value;try{ensureSelectable(p,r.quantity);return meetsRequirements(p,r)?[p]:[];}catch{return [];}}).sort((a,b)=>a.price!-b.price!);
  results.push({...r,candidates,queryMatched:queryMatches.length,constraintRejected:queryMatches.filter(p=>p.detailed&&!meetsRequirements(p,r)).length,searchHint:candidates.length?undefined:"No verified candidates. Retry now using each exact article separately via search_catalog/get_product, or a shorter query. Do not ask permission to retry. constraints are exact single values, not ranges or lists; preserve the customer requirements. A search miss is not proof of absence.",matchedInSample:matches.length,checkedCount:checked.filter(r=>r.status==='fulfilled').length,unavailableCount:checked.filter(r=>r.status==='rejected').length,missing:candidates.length===0});
 }
 return {requirements:results,catalogCount:catalog.items.length,scope:'loaded_sample',warning:'Цены проверены только для возвращённых кандидатов; остальные товары и совместимость за пределами заданных характеристик не подтверждены. Не выдавайте более высокую цену за лучшее качество.'};
}
export async function prepareSolution(input:SolutionDraft){
 let draft:SolutionDraft;try{draft=validateSolutionDraft(input);}catch(e){throw new ApiError(422,'INVALID_SOLUTION',(e as Error).message);}
 const ids=[...new Set(draft.options.flatMap(o=>o.items.map(i=>i.id)))];const fresh=await Promise.all(ids.map(id=>detail(id)));let plan:SolutionPlan;try{plan=buildSolutionPlan(draft,new Map(fresh.map(p=>[p.id,p])));}catch(e){throw new ApiError(409,'SOLUTION_UNVERIFIED',(e as Error).message);}
 return plan;
}
export async function selectSolution(sid:string,id:string,key:unknown,confirmed:unknown):Promise<AgentReply>{
 if(confirmed!==true)throw new ApiError(422,'CONFIRMATION_REQUIRED','Выберите вариант и подтвердите добавление всего комплекта.');
 if(key!=='budget'&&key!=='extended')throw new ApiError(422,'INVALID_OPTION','Выберите один из предложенных вариантов.');
 const row=await db().prepare('SELECT * FROM solutions WHERE id=? AND session_id=?').bind(id,sid).first<{payload:string;status:string;selected_key:string|null;expires:number;operation_token:string|null}>();if(!row)throw new ApiError(404,'NOT_FOUND','Подбор не найден.');
 const plan=JSON.parse(row.payload) as SolutionPlan,option=plan.options.find(o=>o.key===key);if(!option)throw new ApiError(422,'INVALID_OPTION','Такого варианта в этом подборе нет.');
 const receipt=async(replayed:boolean):Promise<AgentReply>=>({conversationStatus:'completed',outcome:'complete',text:replayed?'Этот комплект уже добавлен. Повторно позиции не добавлялись.':`Готово: комплект «${option.title}» добавлен в тестовую корзину целиком (${option.items.length} поз.). Заказ в магазине не оформлен. Обоснование выбора сохранено в отчёте.`,mode:'agent',products:[],steps:[{label:'Повторная проверка всех позиций и добавление комплекта',ok:true}],suggestions:[],cartLink:'/?view=cart',cart:await getCart(sid),solutionReceipt:{...plan,status:'applied' as const,selectedKey:key},replayed});
 if(row.status==='applied'){if(row.selected_key!==key)throw new ApiError(409,'SOLUTION_ALREADY_SELECTED','Другой вариант этого подбора уже добавлен. Для смены скорректируйте корзину.');const result=await receipt(true);await persistReplay(sid,result);return result;}
 if(row.status!=='pending'||row.expires<Date.now())throw new ApiError(410,'SOLUTION_EXPIRED','Подбор устарел или заменён новым. Попросите агента обновить варианты.');
 const fresh=await Promise.all(option.items.map(i=>detail(i.product.id)));
 for(let index=0;index<fresh.length;index++){const p=fresh[index],item=option.items[index],requirement=plan.requirements.find(r=>r.id===item.requirementId)!;try{ensureSelectable(p,item.quantity);}catch(e){throw new ApiError(409,'SOLUTION_CHANGED',(e as Error).message+' Корзина не изменена. Обновите подбор.');}if(p.price!==item.product.price||!meetsRequirements(p,requirement)||JSON.stringify(p.attributes)!==JSON.stringify(item.product.attributes))throw new ApiError(409,'SOLUTION_CHANGED','Цена или характеристики изменились. Корзина не изменена. Попросите обновить подбор.');item.product=p;}
 plan.status='applied';plan.selectedKey=key;const token=crypto.randomUUID(),now=Date.now();
 const conditions=option.items.map(()=>'?+COALESCE((SELECT quantity FROM cart WHERE session_id=? AND product_id=?),0)<=?').join(' AND ');
 const limits=option.items.flatMap(i=>[i.quantity,sid,i.product.id,demoStock(i.product)]);
 const update=db().prepare("UPDATE solutions SET status='applied',selected_key=?,operation_token=?,payload=? WHERE id=? AND session_id=? AND status='pending' AND expires>? AND "+conditions).bind(key,token,JSON.stringify(plan),id,sid,now,...limits);
 const message={conversationStatus:'completed',outcome:'complete',suggestions:[],text:`Клиент выбрал комплект «${option.title}»: ${option.items.map(i=>i.quantity+' × '+i.product.name).join('; ')}. Все позиции добавлены в тестовую корзину. Заказ в магазине не оформлен.`,cartLink:'/?view=cart',solutionReceipt:plan};
 await db().batch([update,db().prepare("UPDATE sessions SET conversation_status='completed',completed_at=? WHERE id=? AND EXISTS (SELECT 1 FROM solutions WHERE id=? AND session_id=? AND operation_token=?)").bind(now,sid,id,sid,token),...option.items.map(item=>db().prepare("INSERT INTO cart(session_id,product_id,product_json,quantity) SELECT session_id,?,?,? FROM solutions WHERE id=? AND session_id=? AND operation_token=? ON CONFLICT(session_id,product_id) DO UPDATE SET quantity=cart.quantity+excluded.quantity,product_json=excluded.product_json").bind(item.product.id,JSON.stringify(item.product),item.quantity,id,sid,token)),db().prepare("INSERT INTO messages(id,session_id,role,content_json,created) SELECT ?,session_id,'assistant',?,? FROM solutions WHERE id=? AND session_id=? AND operation_token=?").bind(crypto.randomUUID(),JSON.stringify(message),now,id,sid,token)]);
 const applied=await db().prepare('SELECT status,selected_key,operation_token FROM solutions WHERE id=? AND session_id=?').bind(id,sid).first<{status:string;selected_key:string;operation_token:string}>();
 if(applied?.status!=='applied')throw new ApiError(409,'SOLUTION_STOCK_CHANGED','Недостаточно остатка с учётом корзины или подбор уже заменён. Ни одна позиция не добавлена. Обновите подбор.');
 if(applied.selected_key!==key)throw new ApiError(409,'SOLUTION_ALREADY_SELECTED','Другой вариант уже добавлен.');return receipt(applied.operation_token!==token);
}


export async function conversationStatus(sid:string):Promise<ConversationStatus>{
 const s=await db().prepare('SELECT conversation_status FROM sessions WHERE id=?').bind(sid).first<{conversation_status:ConversationStatus}>();return s?.conversation_status??'active';
}
export async function setConversationStatus(sid:string,status:ConversationStatus){
 const lock=await db().prepare('SELECT token FROM agent_locks WHERE session_id=? AND expires>?').bind(sid,Date.now()).first();
 if(lock)throw new ApiError(409,'AGENT_BUSY','Дождитесь завершения текущего ответа.');
 await db().prepare('UPDATE sessions SET conversation_status=?,completed_at=? WHERE id=?').bind(status,status==='completed'?Date.now():null,sid).run();return {conversationStatus:status};
}
function singleMessage(prop:{quantity:number},p:Product,replayed:boolean):AgentReply{
 return {text:replayed?'Этот товар уже добавлен. Повторно количество не увеличено.':`Готово: ${prop.quantity} × ${p.name} добавлено в тестовую корзину. Заказ в магазине не оформлен.`,mode:'agent',products:[],steps:[{label:'Проверка цены, остатка и добавление товара',ok:true}],suggestions:[],cartLink:'/?view=cart',outcome:'complete',conversationStatus:'completed',replayed};
}
async function singleReceipt(sid:string,prop:{quantity:number},p:Product,replayed:boolean){const result={...singleMessage(prop,p,replayed),status:'applied',cart:await getCart(sid)};if(replayed)await persistReplay(sid,result);return result;}
async function persistReplay(sid:string,result:AgentReply){await db().batch([db().prepare("UPDATE sessions SET conversation_status='completed',completed_at=? WHERE id=?").bind(Date.now(),sid),db().prepare('INSERT INTO messages(id,session_id,role,content_json,created) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),sid,'assistant',JSON.stringify({...result,cart:undefined}),Date.now())]);}
async function availableSelections(sid:string,offer?:{solution?:SolutionPlan;proposal?:{id:string}}){
 const selections:{id:string;optionKeys:string[];status:string;options:unknown}[]=[];
 if(offer?.solution){const r=await db().prepare('SELECT payload,status FROM solutions WHERE id=? AND session_id=?').bind(offer.solution.id,sid).first<{payload:string;status:string}>();if(r){const p=JSON.parse(r.payload) as SolutionPlan;selections.push({id:p.id,optionKeys:p.options.map(o=>o.key),status:r.status,options:p.options.map(o=>({key:o.key,title:o.title,total:o.total,items:o.items.map(i=>({id:i.product.id,name:i.product.name,quantity:i.quantity}))}))});}}
 if(offer?.proposal){const r=await db().prepare('SELECT id,status,product_json,quantity,price FROM proposals WHERE id=? AND session_id=?').bind(offer.proposal.id,sid).first<{id:string;status:string;product_json:string;quantity:number;price:number}>();if(r)selections.push({id:r.id,optionKeys:['single'],status:r.status,options:[{key:'single',product:JSON.parse(r.product_json),quantity:r.quantity,total:r.price*r.quantity}]});}
 return selections;
}
export async function setCartQuantity(sid:string,id:string,quantity:number):Promise<AgentReply>{
 if(!Number.isSafeInteger(quantity)||quantity<0||quantity>100000)throw new ApiError(422,'INVALID_QUANTITY','Укажите целое количество от 0 до 100000.');
 const row=await db().prepare('SELECT product_json,quantity FROM cart WHERE session_id=? AND product_id=?').bind(sid,id).first<{product_json:string;quantity:number}>();
 if(!row)throw new ApiError(404,'CART_ITEM_NOT_FOUND','В этой корзине такой позиции нет.');
 const old=JSON.parse(row.product_json) as Product;const p=quantity>0?await detail(id):old;
 if(quantity>0){try{ensureSelectable(p,quantity);}catch(e){throw new ApiError(409,'CART_ITEM_UNAVAILABLE',(e as Error).message);}if(p.price!==old.price)throw new ApiError(409,'PRICE_CHANGED','Цена изменилась. Откройте товар и подтвердите новое предложение.');}
 const result:AgentReply={text:quantity===0?`Удалено из тестовой корзины: ${p.name}.`:`Количество обновлено: ${p.name} — ${quantity} шт.`,mode:'agent',products:[],steps:[{label:quantity===0?'Удаление выбранной позиции':'Проверка товара и изменение количества',ok:true}],suggestions:[],outcome:'complete',conversationStatus:'completed',cartLink:'/?view=cart'};
 await db().batch([quantity===0?db().prepare('DELETE FROM cart WHERE session_id=? AND product_id=?').bind(sid,id):db().prepare('UPDATE cart SET quantity=?,product_json=? WHERE session_id=? AND product_id=?').bind(quantity,JSON.stringify(p),sid,id),db().prepare("UPDATE sessions SET conversation_status='completed',completed_at=? WHERE id=?").bind(Date.now(),sid),db().prepare('INSERT INTO messages(id,session_id,role,content_json,created) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),sid,'assistant',JSON.stringify(result),Date.now())]);
 return {...result,cart:await getCart(sid)};
}
