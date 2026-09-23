'use client';
import {useState} from 'react';
import {Package} from 'lucide-react';
import type {Product} from '@/lib/catalog';
export const money=(n:number|null)=>n===null?'Цена не указана':n===0?'Цена 0 · уточнить':new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(n)+' ₸';
export const dataTime=(value:string|null|undefined)=>value?new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Almaty'}).format(new Date(value))+' (КЗ)':'время неизвестно';
export function ProductImage({product,detail=false}:{product:Product;detail?:boolean}){const[failed,setFailed]=useState(false);return product.image&&!failed?<img className={detail?'detail-image':undefined} src={product.image} alt={product.name} loading="lazy" onError={()=>setFailed(true)}/>:<div className={detail?'detail-image image-fallback':'image-fallback'}><Package size={48}/><span>Нет изображения</span></div>;}
