export type RawProduct = {id:number; name:string; article:string; price:number; image?:string; url:string; description?:string; quantity?:number; stores?:{id:number;name:string;quantity:number}[]; properties?:Record<string,unknown>; offers?:unknown[]};
export type Product = ReturnType<typeof normalize>;
export const propertyNames:Record<string,string> = {TORGOVAYA_MARKA:'Производитель',KOLICHESTVO_POLYUSOV:'Количество полюсов',NOMINALNYY_TOK:'Номинальный ток',NOMINALNOE_NAPRYAZHENIE:'Напряжение',NOMINALNAYA_OTKLYUCHAYUSHCHAYA_SPOSOBNOST:'Отключающая способность',TIP_USTANOVKI:'Тип установки',ARTIKULPOSTAVSHCHIKA:'Артикул производителя',MOSHCHNOST:'Мощность',STEPEN_ZASHCHITY:'Степень защиты',TSVETOVAYA_TEMPERATURA:'Цветовая температура'};
export function safeUrl(v:unknown) { try { const u=new URL(String(v)); return u.protocol==='https:' && (u.hostname==='ekt.kz'||u.hostname==='www.ekt.kz') ? u.href : ''; } catch {return '';} }
export function plain(v:unknown) {return String(v??'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').trim();}
export function normalize(p:RawProduct) {
 const props=p.properties??{}; const name=plain(p.name).replace(/^\*+\s*/, '');
 const category=/свет|led|ламп|прожектор/i.test(name)?'Освещение':/кабел|провод|шнур/i.test(name)?'Кабель и провод':/розет|выключатель.*клав|рамк/i.test(name)?'Розетки и выключатели':'Электрооборудование';
 const namedCurrent=(name+' '+plain(p.description)).match(/(?:\b|\s)(\d+(?:[.,]\d+)?)\s*[АA](?=\s|,|\.|$)/i)?.[1];
 const propCurrent=plain(props.NOMINALNYY_TOK).match(/\d+(?:[.,]\d+)?/)?.[0];
 const conflict=!!(namedCurrent&&propCurrent&&Number(namedCurrent.replace(',','.'))!==Number(propCurrent.replace(',','.')));
 return {id:String(p.id),name,sku:String(p.article??''),manufacturerSku:plain(props.ARTIKULPOSTAVSHCHIKA),brand:plain(props.TORGOVAYA_MARKA)||(/legrand/i.test(name)?'Legrand':/megalight/i.test(name)?'MEGALIGHT':''),category,price:Number(p.price),image:safeUrl(p.image),url:safeUrl(p.url),description:plain(p.description),quantity:typeof p.quantity==='number'?p.quantity:null,stores:(p.stores??[]).map(s=>({...s,name:plain(s.name)})),attributes:Object.entries(propertyNames).filter(([k])=>props[k]!=null).map(([k,label])=>({key:k,label,value:plain(props[k])})),properties:props,hasOffers:!!p.offers?.length,conflict,conflictText:conflict?`В названии или описании указан ток ${namedCurrent} А, в характеристиках — ${propCurrent} А. Уточните параметр у менеджера перед выбором.`:'',detailed:!!p.properties};
}
export function tokenMatches(hay:string, token:string) {
 const w=token.toLowerCase();
 if(hay.includes(w))return true;
 if(/^ламп/.test(w))return /ламп|led|светильник/.test(hay);
 if(/^автомат/.test(w))return /автомат|\bав\s|диф\.авт|\sав\s/.test(hay);
 if(/^кабел/.test(w))return /кабел|провод/.test(hay);
 if(/^розет/.test(w))return /розет/.test(hay);
 return false;
}
export function searchProducts(products:Product[],query:string,category='Все товары') {
 const tokens=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
 return products.filter(p=>(category==='Все товары'||p.category===category)&&tokens.every(t=>tokenMatches(`${p.name} ${p.sku} ${p.manufacturerSku} ${p.brand} ${p.id}`.toLowerCase(),t)));
}
export function validateQuantity(quantity:unknown) {if(typeof quantity!=='number'||!Number.isSafeInteger(quantity)||quantity<1||quantity>100000) throw new Error('Количество должно быть целым числом от 1 до 100 000.'); return quantity;}
export function demoStock(p:Product) {return Math.max(0,p.stores.length?p.stores.filter(s=>!/брак|резерв/i.test(s.name)).reduce((n,s)=>n+Math.max(0,s.quantity),0):p.quantity??0);}
export function matchingAlternatives(source:Product, candidates:Product[]) {
 const required=['KOLICHESTVO_POLYUSOV','NOMINALNYY_TOK','NOMINALNOE_NAPRYAZHENIE','NOMINALNAYA_OTKLYUCHAYUSHCHAYA_SPOSOBNOST'];
 const norm=(v:unknown)=>plain(v).toLowerCase().replace(/\s+/g,'').replaceAll(',','.');
 if(source.conflict||required.some(k=>!source.properties[k])) return [];
 return candidates.filter(p=>p.id!==source.id&&!p.conflict&&p.category===source.category&&required.every(k=>p.properties[k]&&norm(p.properties[k])===norm(source.properties[k]))).slice(0,5);
}
