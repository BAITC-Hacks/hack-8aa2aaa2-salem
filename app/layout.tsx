import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'ЭКТ — каталог с помощником',description:'Подбор электротехники по реальному каталогу ekt.kz. Прототип с тестовой корзиной.',icons:{icon:'/favicon.svg',shortcut:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="ru"><body>{children}</body></html>;}
