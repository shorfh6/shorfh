import {canonicalOkazArticle} from './rss-discovery.mjs';
import {assertNoSecrets} from './envelope.mjs';
import {createHash} from 'node:crypto';

const check=(v,code)=>{if(!v)throw Error(code);};
export function adoptResearch(result,notice){
  check(result?.status==='completed','NEWSROOM_RESEARCH_BLOCKED');
  const p=result.output?.proposals;assertNoSecrets(p);
  check(p&&Array.isArray(p.facts)&&p.facts.length>=2&&p.facts.length<=5&&Array.isArray(p.evidence)&&p.evidence.length>=1&&p.evidence.length<=8,'NEWSROOM_RESEARCH_SCHEMA');
  const evidence=p.evidence.map((e,i)=>{
    for(const k of ['excerpt','location','context','attribution'])check(typeof e[k]==='string'&&e[k].trim()&&e[k].length<=350,'NEWSROOM_RESEARCH_SCHEMA');
    check(e.sourceId==='okaz'&&e.id===`e${i+1}`,'NEWSROOM_RESEARCH_SCHEMA');return{id:e.id,sourceId:'okaz',excerpt:e.excerpt,location:e.location,context:e.context,attribution:e.attribution};
  });
  check(evidence.reduce((n,e)=>n+e.excerpt.length,0)<=700,'NEWSROOM_QUOTE_LIMIT');
  const facts=p.facts.map((c,i)=>{
    check(c.id===`c${i+1}`&&typeof c.text==='string'&&c.text.trim()&&c.text.length<=700&&Array.isArray(c.evidenceIds)&&c.evidenceIds.length&&c.evidenceIds.every(id=>evidence.some(e=>e.id===id)),'NEWSROOM_RESEARCH_SCHEMA');
    return{id:c.id,text:c.text,evidenceIds:c.evidenceIds};
  });
  check(p.risk==='routine','NEWSROOM_ESCALATION_REQUIRED');
  return{version:'raad.editorial-evidence/1',site:'https://www.shurfh.com',sourceUrls:{okaz:canonicalOkazArticle(notice.url)},publicationDates:{rssPublishedAt:notice.publishedAt,sourceDate:notice.sourceDate},sourceRelationship:'Owner-selected Okaz report; all source-specific claims must be explicitly attributed, not represented as independent official confirmation.',facts,evidence,scope:'Selected article facts and brief evidence only; no source-body or publisher-photo republication.'};
}
export function adoptEditing(result,categories){
  check(result?.status==='completed','NEWSROOM_EDITING_BLOCKED');const p=result.output?.proposal;assertNoSecrets(p);
  check(p&&typeof p.title==='string'&&p.title.trim().length>=10&&p.title.length<=180&&typeof p.excerpt==='string'&&p.excerpt.trim().length>0&&p.excerpt.length<=250&&typeof p.body==='string'&&p.body.trim().length>0&&p.body.length<=12000,'NEWSROOM_EDITING_SCHEMA');
  check(p.seoTitle===p.title&&p.metaDescription===p.excerpt&&categories.some(c=>c.id===p.categoryId),'NEWSROOM_SEO_CATEGORY');
  check(!/^(?:بحسب|وفق(?:ًا|ا)?(?:\s+لما)?|نقل[ًاا]\s+عن)\s+عكاظ|^عكاظ\s*[:：-]/u.test(p.title.trim()),'NEWSROOM_ORIGINAL_HEADLINE_REQUIRED');
  check(Array.isArray(p.tagNames)&&p.tagNames.length<=6&&p.tagNames.every(t=>typeof t==='string'&&t.trim()&&t.length<=40)&&new Set(p.tagNames).size===p.tagNames.length,'NEWSROOM_TAGS');
  check(Array.isArray(p.claimMap)&&p.claimMap.length>0,'NEWSROOM_CLAIM_MAP');
  return{title:p.title.trim(),excerpt:p.excerpt.trim(),body:p.body.trim(),seoTitle:p.title.trim(),metaDescription:p.excerpt.trim(),categoryId:p.categoryId,tagNames:p.tagNames,claimMap:p.claimMap};
}
// Structural coverage only; authentic editing/final reviews still assess whether text supports facts.
export function assertEditorialClaimMap(claimMap, facts){
  check(Array.isArray(claimMap)&&claimMap.length>0,'NEWSROOM_CLAIM_MAP');
  const claims=new Map(facts.facts.map(c=>[c.id,c])),evidence=new Set(facts.evidence.map(e=>e.id)),covered=new Set();
  for(const row of claimMap){
    check(row&&typeof row==='object'&&!Array.isArray(row),'NEWSROOM_CLAIM_MAP');
    const singular=Object.hasOwn(row,'claimId'),plural=Object.hasOwn(row,'claimIds');
    check(singular!==plural,'NEWSROOM_CLAIM_MAP');
    const ids=singular?[row.claimId]:row.claimIds;
    check(Array.isArray(ids)&&ids.length>0&&new Set(ids).size===ids.length&&ids.every(id=>typeof id==='string'&&claims.has(id)),'NEWSROOM_CLAIM_MAP_IDS');
    for(const field of ['section','paragraph'])if(Object.hasOwn(row,field))check(
      typeof row[field]==='string'&&row[field].trim().length>0||field==='paragraph'&&Number.isSafeInteger(row[field])&&row[field]>=0,'NEWSROOM_CLAIM_MAP_LOCATION');
    if(Object.hasOwn(row,'evidenceIds')){
      const refs=row.evidenceIds;
      check(Array.isArray(refs)&&refs.length>0&&new Set(refs).size===refs.length&&refs.every(id=>typeof id==='string'&&evidence.has(id)&&ids.some(c=>claims.get(c).evidenceIds.includes(id)))&&
        ids.every(c=>refs.some(id=>claims.get(c).evidenceIds.includes(id))),'NEWSROOM_CLAIM_MAP_EVIDENCE');
    }
    ids.forEach(id=>covered.add(id));
  }
  check(facts.facts.every(c=>covered.has(c.id)),'NEWSROOM_CLAIM_COVERAGE');
  return true;
}
export function selectNotice(discovery,processed,now=new Date().toISOString()){
  const clock=Date.parse(now);check(Number.isFinite(clock),'NEWSROOM_CLOCK');
  return Object.values(discovery.items??{}).filter(c=>{
    if(processed.has(c.id)||!/^([a-f0-9]{64})$/.test(c.id??''))return false;
    try{const url=canonicalOkazArticle(c.url);if(c.id!==createHash('sha256').update('okaz\n'+url).digest('hex'))return false;}catch{return false;}
    const time=Date.parse(c.publishedAt);return Number.isFinite(time)&&time<=clock&&clock-time<=86400000;
  }).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)||a.id.localeCompare(b.id))[0]??null;
}
