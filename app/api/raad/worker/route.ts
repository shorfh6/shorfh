import {runApprovedPublicationTick,storedWorkerConfiguration} from "@/lib/publication-queue";
import {resolveWorkerAccess} from "@/lib/publication-worker.mjs";

export const dynamic="force-dynamic";
export const runtime="nodejs";

export async function POST(request:Request){
  const headers={"cache-control":"private, no-store","x-robots-tag":"noindex"};
  let access;
  try{access=await resolveWorkerAccess(request.headers.get("x-raad-worker-key"),{RAAD_WORKER_SECRET:process.env.RAAD_WORKER_SECRET,RAAD_WORKER_ENABLED:process.env.RAAD_WORKER_ENABLED},storedWorkerConfiguration);}
  catch{return Response.json({error:"worker_unavailable"},{status:503,headers});}
  if(!access.authorized){
    return Response.json({error:"not_found"},{status:404,headers});
  }
  if(!access.enabled)return Response.json({error:"worker_disabled"},{status:503,headers});
  try{
    const result=await runApprovedPublicationTick();
    return Response.json(result,{headers});
  }catch{
    return Response.json({error:"worker_unavailable"},{status:503,headers});
  }
}
