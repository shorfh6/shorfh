import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {OKAZ_FEEDS,fetchOkazFeed} from './rss-discovery.mjs';

export async function pollOkazRss(directory,{fetchFeed=fetchOkazFeed,now=()=>new Date().toISOString()}={}){
  if(!path.isAbsolute(directory)||!fs.statSync(directory).isDirectory()||fs.lstatSync(directory).isSymbolicLink())throw Error('RSS_ABSOLUTE_EXISTING_DIRECTORY_REQUIRED');
  const lock=path.join(directory,'discovery.lock');let fd;
  try{fd=fs.openSync(lock,'wx',0o600);}catch(error){if(error.code==='EEXIST')return{state:'locked',newCandidates:0};throw error;}
  const file=path.join(directory,'discovery.json'),pending=path.join(directory,'discovery.pending.json');
  try{
    let previous={version:1,lastPoll:null,items:{}};
    if(fs.existsSync(file)){
      if(fs.lstatSync(file).isSymbolicLink()||fs.statSync(file).size>16*1024*1024)throw Error('RSS_STATE_REJECTED');
      previous=JSON.parse(fs.readFileSync(file,'utf8'));
      if(previous.version!==1||!previous.items||Array.isArray(previous.items))throw Error('RSS_STATE_REJECTED');
    }
    const observedAt=now();if(!Number.isFinite(Date.parse(observedAt)))throw Error('RSS_CLOCK');
    if(previous.lastPoll&&Date.parse(observedAt)-Date.parse(previous.lastPoll)<300000)return{state:'not_due',newCandidates:0};
    if(Object.keys(previous.items).length>10000)throw Error('RSS_STATE_CAPACITY');
    const items={...previous.items},errors=[];let added=0,rejected=0;
    for(const feed of OKAZ_FEEDS){
      try{
        const result=await fetchFeed(feed);rejected+=result.rejected.length;
        for(const candidate of result.candidates){
          if(items[candidate.id])continue;
          if(Object.keys(items).length>=10000)throw Error('RSS_STATE_CAPACITY');
          // Old/undated stories remain discoveries but cannot be auto-selected as
          // new news. Approval, article creation and publication are separate.
          const age=candidate.publishedAt?Date.parse(observedAt)-Date.parse(candidate.publishedAt):Infinity;
          items[candidate.id]={...candidate,eligibleForReview:age>=0&&age<=86400000};added++;
        }
      }catch(error){if(error.message==='RSS_STATE_CAPACITY')throw error;errors.push({feed,code:/^RSS_[A-Z_]+$/.test(error.message)?error.message:'RSS_FETCH_FAILED'});}
    }
    const state={version:1,lastPoll:observedAt,items,errors};
    const out=fs.openSync(pending,'wx',0o600);try{fs.writeFileSync(out,JSON.stringify(state)+'\n');fs.fsyncSync(out);}finally{fs.closeSync(out);}
    fs.renameSync(pending,file);
    const receipt={at:observedAt,event:'rss_poll',newCandidates:added,totalCandidates:Object.keys(items).length,rejected,failedFeeds:errors.length,articlesCreated:0,articlesPublished:0};
    fs.appendFileSync(path.join(directory,'audit.jsonl'),JSON.stringify(receipt)+'\n',{mode:0o600});
    return{state:errors.length?'partial':'discovered',...receipt};
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const args=process.argv.slice(2);
  if(args.length!==3||args[0]!=='--directory'||args[2]!=='--execute-reader')throw Error('RSS_EXPLICIT_READER_ARGUMENTS_REQUIRED');
  pollOkazRss(args[1]).then(result=>{console.log(JSON.stringify(result));if(result.failedFeeds)process.exitCode=1;}).catch(error=>{console.error(JSON.stringify({error:/^RSS_[A-Z_]+$/.test(error.message)?error.message:'RSS_DISCOVERY_FAILED'}));process.exitCode=1;});
}
