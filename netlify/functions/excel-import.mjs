import { inflateRawSync } from 'node:zlib';

const reply=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const clean=(v,n=500)=>String(v??'').trim().replace(/\s+/g,' ').slice(0,n);
const entity=s=>String(s??'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)));

function unzip(buf){
  const files=new Map();
  let eocd=-1;
  for(let i=buf.length-22;i>=Math.max(0,buf.length-65557);i--){if(buf.readUInt32LE(i)===0x06054b50){eocd=i;break}}
  if(eocd<0)throw Error('Excelファイルの構造を確認できませんでした。');
  const count=buf.readUInt16LE(eocd+10), central=buf.readUInt32LE(eocd+16);
  let p=central;
  for(let i=0;i<count;i++){
    if(buf.readUInt32LE(p)!==0x02014b50)throw Error('Excelファイルの索引が壊れています。');
    const method=buf.readUInt16LE(p+10), compSize=buf.readUInt32LE(p+20), nameLen=buf.readUInt16LE(p+28), extraLen=buf.readUInt16LE(p+30), commentLen=buf.readUInt16LE(p+32), local=buf.readUInt32LE(p+42);
    const name=buf.subarray(p+46,p+46+nameLen).toString('utf8');
    if(buf.readUInt32LE(local)!==0x04034b50)throw Error('Excelファイルの内容が壊れています。');
    const ln=buf.readUInt16LE(local+26), le=buf.readUInt16LE(local+28), start=local+30+ln+le, comp=buf.subarray(start,start+compSize);
    let data;
    if(method===0)data=comp;else if(method===8)data=inflateRawSync(comp);else throw Error('対応していないExcel圧縮形式です。');
    files.set(name,data);
    p+=46+nameLen+extraLen+commentLen;
  }
  return files;
}
function text(files,path){const b=files.get(path);if(!b)throw Error(`${path} が見つかりません。`);return b.toString('utf8')}
function sharedStrings(files){
  if(!files.has('xl/sharedStrings.xml'))return [];
  const xml=text(files,'xl/sharedStrings.xml'), out=[];
  for(const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)){
    const parts=[...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x=>entity(x[1]));
    out.push(parts.join(''));
  }
  return out;
}
function dataSheetPath(files){
  const wb=text(files,'xl/workbook.xml'), rel=text(files,'xl/_rels/workbook.xml.rels');
  const sheet=[...wb.matchAll(/<sheet\b([^>]*)\/?>(?:<\/sheet>)?/g)].map(m=>m[1]).find(a=>/name="データ"/.test(a));
  if(!sheet)throw Error('「データ」シートが見つかりません。対応するExcel出力か確認してください。');
  const rid=(sheet.match(/r:id="([^"]+)"/)||[])[1];
  const r=[...rel.matchAll(/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/g)].map(m=>m[1]).find(a=>new RegExp(`Id="${rid}"`).test(a));
  const target=(r?.match(/Target="([^"]+)"/)||[])[1];
  if(!target)throw Error('「データ」シートの場所を確認できません。');
  return target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');
}
function colIndex(ref){let n=0;for(const c of ref.replace(/\d/g,''))n=n*26+c.charCodeAt(0)-64;return n-1}
function parseSheet(xml,shared){
  const rows=[];
  for(const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)){
    const row=[];
    for(const cm of rm[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)){
      const attrs=cm[1], body=cm[2], ref=(attrs.match(/r="([A-Z]+\d+)"/)||[])[1];if(!ref)continue;
      const t=(attrs.match(/t="([^"]+)"/)||[])[1];let v='';
      if(t==='inlineStr'){v=[...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x=>entity(x[1])).join('')}
      else {const raw=(body.match(/<v>([\s\S]*?)<\/v>/)||[])[1]??'';v=t==='s'?shared[Number(raw)]??'':entity(raw)}
      row[colIndex(ref)]=v;
    }
    rows.push(row);
  }
  return rows;
}
function parseRakuraku(buf){
  const files=unzip(buf), rows=parseSheet(text(files,dataSheetPath(files)),sharedStrings(files));
  const headerIndex=rows.findIndex(r=>r.some(v=>clean(v)==='商品名')&&r.some(v=>clean(v)==='数量'));
  if(headerIndex<0)throw Error('商品名・数量の列を確認できませんでした。');
  const headers=rows[headerIndex].map(v=>clean(v,50));
  const at=name=>headers.indexOf(name), ci=at('得意先名'), pi=at('商品名'), p2i=at('商品名２'), qi=at('数量'), bi=at('備考'), li=at('行番号');
  if(pi<0||qi<0)throw Error('Excelの明細列を確認できませんでした。');
  let client='', displayName='';const items=[];
  const totalRx=/見積総合計|見積外消費税|見積合計|総合計/;
  for(const r of rows.slice(headerIndex+1)){
    const c=clean(r[ci],100), product=clean(r[pi],200), spec=clean(r[p2i],300), remarks=clean(r[bi],300), line=clean(r[li],20), quantity=Number(String(r[qi]??'').replace(/,/g,''))||0;
    if(c&&!client)client=c;if(!product||totalRx.test(product))continue;
    if(quantity<=0){if(!displayName&&!/^※/.test(product))displayName=product;continue}
    items.push({line,productName:product,spec,quantity,remarks,selected:true});
  }
  if(!items.length)throw Error('登録できる商品明細が見つかりませんでした。');
  return {client,displayName,items};
}
export default async req=>{
  if(req.method!=='POST')return reply({error:'対応していない操作です。'},405);
  try{
    const body=await req.json(), base64=String(body.base64||'');
    if(!base64)return reply({error:'Excelファイルを選択してください。'},400);
    const buf=Buffer.from(base64,'base64');
    if(buf.length>10*1024*1024)return reply({error:'ファイルサイズが大きすぎます。'},413);
    if(buf.length<4||buf.readUInt32LE(0)!==0x04034b50)return reply({error:'このファイルは正常なExcel（.xlsx）ではありません。'},400);
    return reply(parseRakuraku(buf));
  }catch(e){console.error(e);return reply({error:e.message||'Excelデータを読み取れませんでした。'},400)}
};
export const config={path:'/api/excel-import'};
