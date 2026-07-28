import { getStore } from '@netlify/blobs';
const STORE='hikari-portal', KEY='masters-v2', TYPES=['employees','clients','displayNames','products'];
const reply=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const blank=()=>({employees:[],clients:[],displayNames:[],products:[]});
const makeId=()=>`${Date.now().toString(36)}_${crypto.randomUUID().replaceAll('-','')}`;
const clean=(v,n=100)=>String(v??'').trim().replace(/\s+/g,' ').slice(0,n);
export default async req=>{
  const store=getStore({name:STORE,consistency:'strong'}), url=new URL(req.url);
  try{
    const data=(await store.get(KEY,{type:'json'}))||blank();
    for(const t of TYPES) if(!Array.isArray(data[t])) data[t]=[];
    if(req.method==='GET') return reply({masters:data});
    const x=await req.json(), type=String(x.type||'');
    if(!TYPES.includes(type)) return reply({error:'マスタ種別が正しくありません。'},400);
    if(req.method==='POST'){
      const name=clean(x.name);
      if(!name) return reply({error:'名称を入力してください。'},400);
      if(data[type].some(v=>v.name===name)) return reply({error:'同じ名称がすでに登録されています。'},400);
      const item={id:makeId(),name,active:true,order:data[type].length};
      data[type].push(item); await store.setJSON(KEY,data); return reply({item},201);
    }
    if(req.method==='PUT'){
      const i=data[type].findIndex(v=>v.id===x.id);
      if(i<0) return reply({error:'項目が見つかりません。'},404);
      if(x.action==='move'){
        const dir=x.direction==='up'?-1:1, j=i+dir;
        if(j>=0&&j<data[type].length){[data[type][i],data[type][j]]=[data[type][j],data[type][i]];data[type].forEach((v,k)=>v.order=k)}
      }else{
        const name=x.name===undefined?data[type][i].name:clean(x.name);
        if(!name) return reply({error:'名称を入力してください。'},400);
        if(data[type].some((v,k)=>k!==i&&v.name===name)) return reply({error:'同じ名称がすでに登録されています。'},400);
        data[type][i]={...data[type][i],name,active:x.active===undefined?data[type][i].active:Boolean(x.active)};
      }
      await store.setJSON(KEY,data); return reply({item:data[type][i]});
    }
    if(req.method==='DELETE'){
      const q=url.searchParams.get('id'); data[type]=data[type].filter(v=>v.id!==q); data[type].forEach((v,k)=>v.order=k);
      await store.setJSON(KEY,data); return reply({ok:true});
    }
    return reply({error:'対応していない操作です。'},405);
  }catch(e){console.error(e);return reply({error:'マスタデータを処理できませんでした。'},500)}
};
export const config={path:'/api/masters'};
