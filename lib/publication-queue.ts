import {one,tx} from "./db";
import {assertPublicationApproved,lockPublicationScope} from "./publication";
import {getImage} from "./storage";
import {runPublicationTick,type PublicationJob} from "./publication-worker.mjs";

let cachedConfiguration:{until:number;value:Promise<{secret?:string;enabled?:boolean}|null>}|undefined;
export async function storedWorkerConfiguration(){
  if(!cachedConfiguration||cachedConfiguration.until<=Date.now()){
    const origin=process.env.SITE_URL??"";
    const value=one<{configuration:{secret?:string;enabled?:boolean}|null}>("SELECT raad_queue.worker_configuration($1) AS configuration",[origin]).then(row=>row?.configuration??null);
    cachedConfiguration={until:Date.now()+5000,value};
  }
  return cachedConfiguration.value;
}

export async function runApprovedPublicationTick(){
  const adapter={
    async claim(worker:string){
      return (await one<{work:PublicationJob|null}>("SELECT raad_queue.claim($1,120) AS work",[worker]))?.work??null;
    },
    async publish(job:PublicationJob,worker:string){
      return tx(async q=>{
        await lockPublicationScope(q);
        const locked=await q.one<{work:PublicationJob}>("SELECT raad_queue.lock_work($1,$2::bigint,$3) AS work",[job.id,job.fence,worker]);
        if(!locked?.work)throw Error("RAAD_QUEUE_NOT_FOUND");
        if(locked.work.state!=="leased")return locked.work;
        await assertPublicationApproved(q,locked.work.articleId,getImage);
        const completed=await q.one<{work:PublicationJob}>("SELECT raad_queue.publish($1,$2::bigint,$3) AS work",[job.id,job.fence,worker]);
        if(!completed?.work)throw Error("RAAD_QUEUE_OUTCOME_UNKNOWN");
        return completed.work;
      });
    },
    async fail(job:PublicationJob,worker:string,reason:string){
      const result=await one<{work:PublicationJob}>("SELECT raad_queue.fail($1,$2::bigint,$3,$4) AS work",[job.id,job.fence,worker,reason]);
      if(!result?.work)throw Error("RAAD_QUEUE_OUTCOME_UNKNOWN");return result.work;
    },
    async uncertain(job:PublicationJob,worker:string){
      const result=await one<{work:PublicationJob}>("SELECT raad_queue.uncertain($1,$2::bigint,$3) AS work",[job.id,job.fence,worker]);
      if(!result?.work)throw Error("RAAD_QUEUE_OUTCOME_UNKNOWN");return result.work;
    },
  };
  return runPublicationTick(adapter);
}
