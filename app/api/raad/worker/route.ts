import {runApprovedPublicationTick} from "@/lib/publication-queue";
import {workerAuthorized} from "@/lib/publication-worker.mjs";

export const dynamic="force-dynamic";
export const runtime="nodejs";

export async function POST(request:Request){
  const headers={"cache-control":"private, no-store","x-robots-tag":"noindex"};
  if(!workerAuthorized(request.headers.get("x-raad-worker-key"),process.env.RAAD_WORKER_SECRET)){
    return Response.json({error:"not_found"},{status:404,headers});
  }
  if(process.env.RAAD_WORKER_ENABLED!=="true")return Response.json({error:"worker_disabled"},{status:503,headers});
  try{
    const result=await runApprovedPublicationTick();
    return Response.json(result,{headers});
  }catch{
    return Response.json({error:"worker_unavailable"},{status:503,headers});
  }
}
