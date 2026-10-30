import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pollOkazRss} from './watch-okaz-rss.mjs';
const make=()=>fs.mkdtempSync(path.join(os.tmpdir(),'raad-rss-test-'));
const item={id:'a'.repeat(64),url:'https://www.okaz.com.sa/local/na/1',title:'SYNTHETIC',publishedAt:'2026-10-29T12:00:00Z',editorialApproval:false};
test('durable discovery survives restart, deduplicates cross-feed items and enforces 300 seconds',async()=>{
 const dir=make();try{let n=0;const fetchFeed=async()=>{n++;return{candidates:[item],rejected:[]};};const now=()=> '2026-10-29T13:00:00Z';const first=await pollOkazRss(dir,{fetchFeed,now});assert.equal(first.newCandidates,1);assert.equal(first.articlesPublished,0);assert.equal(n,5);assert.equal((await pollOkazRss(dir,{fetchFeed,now})).state,'not_due');assert.equal(n,5);const next=await pollOkazRss(dir,{fetchFeed,now:()=> '2026-10-29T13:05:00Z'});assert.equal(next.newCandidates,0);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'discovery.json'),'utf8')).items[item.id].editorialApproval,false);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('lock prevents overlapping pollers; a failed feed does not erase stored discoveries',async()=>{
 const dir=make();try{fs.writeFileSync(path.join(dir,'discovery.lock'),'');assert.equal((await pollOkazRss(dir)).state,'locked');fs.unlinkSync(path.join(dir,'discovery.lock'));const result=await pollOkazRss(dir,{now:()=> '2026-10-29T13:00:00Z',fetchFeed:async feed=>{if(feed.endsWith('/2'))throw Error('RSS_FETCH_FAILED');return{candidates:[item],rejected:[]};}});assert.equal(result.state,'partial');assert.equal(result.failedFeeds,1);assert.equal(result.totalCandidates,1);assert.equal(fs.existsSync(path.join(dir,'discovery.lock')),false);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('old and undated notices are not selected for current-news review',async()=>{
 const dir=make();try{await pollOkazRss(dir,{now:()=> '2026-11-02T13:00:00Z',fetchFeed:async()=>({candidates:[item,{...item,id:'b'.repeat(64),publishedAt:null}],rejected:[]})});const state=JSON.parse(fs.readFileSync(path.join(dir,'discovery.json'),'utf8'));assert.ok(Object.values(state.items).every(x=>x.eligibleForReview===false));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
