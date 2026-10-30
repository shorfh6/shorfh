import {createHash} from 'node:crypto';
import {XMLParser} from 'fast-xml-parser';

export const OKAZ_FEEDS=Object.freeze([1,2,3,8,194].map(section=>`https://www.okaz.com.sa/rssFeed/${section}`));
const MAX_BYTES=2*1024*1024;
const fail=code=>{throw Error(code);};
const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,processEntities:false,maxNestedTags:32,ignoreDeclaration:true,ignorePiTags:true,isArray:(_tag,path)=>path==='rss.channel.item'});
function decode(value){
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(match,entity)=>{
    if(entity[0]==='#'){const n=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'';}
    return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[entity.toLowerCase()]??match;
  });
}
function text(value){return typeof value==='string'?value:typeof value?.['#text']==='string'?value['#text']:'';}
export function canonicalOkazArticle(value){
  if(typeof value!=='string'||value.length>2000||/[\x00-\x20\\]/.test(value)||/%(?:2e|2f|5c|25)/i.test(value))fail('RSS_ARTICLE_URL');
  const url=new URL(value);
  if(url.protocol!=='https:'||url.hostname!=='www.okaz.com.sa'||url.port||url.username||url.password||!/^\/[a-z-]+\/[a-z-]+\/\d+\/?$/.test(url.pathname))fail('RSS_ARTICLE_URL');
  return url.origin+url.pathname.replace(/\/$/,'');
}
export function parseOkazFeed(xml,feedUrl,observedAt=new Date().toISOString()){
  if(!OKAZ_FEEDS.includes(feedUrl))fail('RSS_FEED_NOT_ALLOWED');
  if(typeof xml!=='string'||Buffer.byteLength(xml)>MAX_BYTES||/<!\s*(DOCTYPE|ENTITY)\b/i.test(xml))fail('RSS_XML_REJECTED');
  if(!Number.isFinite(Date.parse(observedAt)))fail('RSS_CLOCK');
  let parsed;try{parsed=parser.parse(xml,true);}catch{fail('RSS_XML_REJECTED');}
  if(parsed?.rss?.['@_version']!=='2.0'||!parsed.rss.channel||Array.isArray(parsed.rss.channel))fail('RSS_FORMAT');
  const items=parsed.rss.channel.item??[];if(!Array.isArray(items)||items.length>500)fail('RSS_ITEM_LIMIT');
  const seen=new Set(),candidates=[],rejected=[];
  for(const item of items){
    try{
      const url=canonicalOkazArticle(decode(text(item.link)).trim()),title=decode(text(item.title)).replace(/<[^>]*>/g,'').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim();
      if(!title||title.length>500)fail('RSS_TITLE');
      const suppliedDate=text(item.pubDate).trim();
      // Preserve the supplied text; only normalize dates with an explicit timezone.
      const dated=/(?:GMT|UT|[+-]\d{4}|Z)\s*$/i.test(suppliedDate)&&Number.isFinite(Date.parse(suppliedDate));
      const publishedAt=dated?new Date(suppliedDate).toISOString():null;
      if(publishedAt&&Date.parse(publishedAt)>Date.parse(observedAt)+300000)fail('RSS_FUTURE_DATE');
      const id=createHash('sha256').update('okaz\n'+url).digest('hex');if(seen.has(id))continue;seen.add(id);
      candidates.push({id,sourceId:'okaz',url,title,publishedAt,sourceDate:suppliedDate.slice(0,100),observedAt,feedUrl,status:'discovered',editorialApproval:false});
    }catch{rejected.push({reason:'invalid_item'});}
  }
  // Descriptions/content/images are intentionally absent: these are discovery
  // notices, never publication candidates or input instructions to reviewers.
  return {candidates,rejected};
}
export async function fetchOkazFeed(feedUrl,{fetchImpl=fetch,now=()=>new Date().toISOString()}={}){
  if(!OKAZ_FEEDS.includes(feedUrl))fail('RSS_FEED_NOT_ALLOWED');
  const response=await fetchImpl(feedUrl,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{accept:'application/rss+xml, application/xml, text/xml','user-agent':'Shurfa-Raad-RSS/1.0 (+https://www.shurfh.com)'}});
  if(response.status!==200||!response.body)fail('RSS_FETCH_FAILED');
  const declared=Number(response.headers.get('content-length'));if(declared>MAX_BYTES){await response.body.cancel();fail('RSS_SIZE');}
  const reader=response.body.getReader(),chunks=[];let bytes=0;
  try{while(true){const{value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_BYTES)fail('RSS_SIZE');chunks.push(value);}}catch(error){try{await reader.cancel();}catch{}throw error;}finally{reader.releaseLock();}
  const xml=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));return parseOkazFeed(xml,feedUrl,now());
}
