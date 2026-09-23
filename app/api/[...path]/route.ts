import {ApiError,json,checkOrigin,body,session,bootstrap,getCatalog,loadNextPage,detail,getCart,propose,confirm,removeCartItem,alternatives,chat} from '@/lib/server';
export const dynamic='force-dynamic';
async function handle(req:Request){try{const path=new URL(req.url).pathname.replace(/^\/api\//,'').split('/');if(req.method==='POST')checkOrigin(req);if(path[0]==='session'&&req.method==='POST')return await bootstrap(req);const s=await session(req);
 if(req.method==='GET'){
  if(path[0]==='products'&&path.length===1)return json(await getCatalog());
  if(path[0]==='products'&&path[2]==='alternatives')return json(await alternatives(path[1]));
  if(path[0]==='products'&&path.length===2)return json(await detail(path[1]));
  if(path[0]==='cart')return json(await getCart(s.id));
 }
 if(req.method==='POST'){const data=await body(req);
  if(path.join('/')==='catalog/load')return json(await loadNextPage());
  if(path[0]==='proposals'&&path.length===1)return json(await propose(s.id,String(data.productId??''),data.quantity),201);
  if(path[0]==='proposals'&&path[2]==='confirm')return json(await confirm(s.id,path[1],data.confirmed));
  if(path.join('/')==='cart/remove')return json(await removeCartItem(s.id,String(data.productId??''),data.confirmed));
  if(path[0]==='chat')return json(await chat(s.id,data.text,data.productId));
 }
 throw new ApiError(404,'NOT_FOUND','Метод не найден.');
 }catch(e){if(e instanceof ApiError)return json({error:{code:e.code,message:e.message}},e.status);console.error('API failure',e instanceof Error?e.name:'Unknown');return json({error:{code:'INTERNAL_ERROR',message:'Не удалось выполнить действие. Попробуйте ещё раз.'}},500);}}
export const GET=handle;export const POST=handle;

