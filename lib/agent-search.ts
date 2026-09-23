import {type Product,tokenMatches,demoStock} from './catalog.ts';

export function agentSearch(products:Product[],query:string,maxPrice:number|null,inStock:boolean){
 const q=query.toLowerCase().replace(/ё/g,'е').replace(/(\d)\s+(а|a|в|v|w|вт)(?=$|[^a-zа-я])/gi,'$1$2');
 const tokens=q.split(/[\s,;]+/).filter(Boolean);
 const folded=(s:string)=>s.toLowerCase().replace(/ё/g,'е').replace(/(\d)\s+(а|a|в|v|w|вт)(?=$|[^a-zа-я])/gi,'$1$2');
 const matches=products.filter(p=>{
  if(maxPrice!==null&&(p.price===null||p.price>maxPrice))return false;
  if(inStock&&demoStock(p)<=0)return false;
  const hay=folded(`${p.name} ${p.sku} ${p.manufacturerSku} ${p.brand} ${p.id}`);
  return tokens.every(t=>{
   // Numeric electrical ratings must match a whole number, not 25A inside 125A.
   if(/^\d+(?:[.,]\d+)?[аaвvw]$/i.test(t))return new RegExp('(^|[^0-9])'+t.replace(/[аa]/i,'[аa]').replace(/[вv]/i,'[вv]')+'(?=$|[^a-zа-я0-9])','i').test(hay);
   return tokenMatches(hay,t);
  });
 });
 matches.sort((a,b)=>{
  const exact=(p:Product)=>[p.sku,p.manufacturerSku,p.id].some(v=>v.toLowerCase()===q)?1:0;
  return exact(b)-exact(a)||(maxPrice!==null?(a.price??Infinity)-(b.price??Infinity):0);
 });
 return {items:matches.slice(0,8),total:matches.length};
}
