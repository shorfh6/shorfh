import {createHash} from "node:crypto";
import {tx} from "@/lib/db";
import {getImage,putImage} from "@/lib/storage";
import {storedWorkerConfiguration} from "@/lib/publication-queue";
import {resolveWorkerAccess} from "@/lib/publication-worker.mjs";
import {readOriginalCard} from "@/lib/original-card.mjs";

export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function GET(request:Request){
  const headers={"cache-control":"private, no-store","x-robots-tag":"noindex"};
  let access;
  try{access=await resolveWorkerAccess(request.headers.get("x-raad-worker-key"),{RAAD_WORKER_SECRET:process.env.RAAD_WORKER_SECRET,RAAD_WORKER_ENABLED:process.env.RAAD_WORKER_ENABLED},storedWorkerConfiguration);}
  catch{return Response.json({error:"worker_unavailable"},{status:503,headers});}
  if(!access.authorized)return Response.json({error:"not_found"},{status:404,headers});
  if(!access.enabled)return Response.json({error:"worker_disabled"},{status:503,headers});
  const id=request.headers.get("x-raad-article-id");
  if(!/^[1-9]\d{0,9}$/.test(id??"")||Number(id)>2147483647)return Response.json({error:"not_found"},{status:404,headers});
  try{
    const data=await tx(async q=>{
      await q.query("SET LOCAL lock_timeout='10s'");
      await q.query("SELECT raad_gate.lock_publication_scope()");
      const article=await q.one<{status:string;image:string;source_url:string}>("SELECT status,image,source_url FROM public.articles WHERE id=$1 FOR UPDATE",[Number(id)]);
      if(article?.status==="published")throw Error("RAAD_CARD_CONFLICT");
      if(!article||article.status!=="draft"||!/^https:\/\/www\.okaz\.com\.sa\/[a-z-]+\/[a-z-]+\/\d+$/.test(article.source_url)||!new RegExp(`^raad-${id}-[a-f0-9]{24}\\.png$`).test(article.image))throw Error("RAAD_CARD_NOT_FOUND");
      let timer:ReturnType<typeof setTimeout>|undefined,reader:ReadableStreamDefaultReader|undefined;
      const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("RAAD_MEDIA_TIMEOUT")),10000);});
      try{
        const pending=getImage(article.image);
        // A download resolving after the deadline must not leave its body open.
        let expired=false;
        const existing=await Promise.race([pending,deadline.catch(error=>{expired=true;void pending.then(image=>image?.body.cancel()).catch(()=>{});throw error;})]);
        if(expired||!existing)throw Error("RAAD_CARD_NOT_FOUND");
        reader=existing.body.getReader();
        if((existing.size??0)>262144)throw Error("RAAD_MEDIA_INVALID");
        const parts:Uint8Array[]=[];let bytes=0;
        while(true){const part=await Promise.race([reader.read(),deadline]);if(part.done)break;bytes+=part.value.byteLength;if(bytes>262144)throw Error("RAAD_MEDIA_INVALID");parts.push(part.value);}
        const body=Buffer.concat(parts);
        const card=await readOriginalCard(new Request("https://raad.invalid/card",{method:"POST",headers:{"content-type":"image/png","x-raad-article-id":id!},body:new Uint8Array(body)}));
        if(card.imageName!==article.image)throw Error("RAAD_MEDIA_INVALID");
        return body;
      }finally{clearTimeout(timer);if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}}
    });
    return new Response(new Uint8Array(data),{headers:{...headers,"content-type":"image/png","content-length":String(data.length),"x-content-type-options":"nosniff"}});
  }catch(error){
    const message=error instanceof Error?error.message:"";
    const status=message==="RAAD_CARD_CONFLICT"?409:["RAAD_CARD_NOT_FOUND","Storage download failed (400)"].includes(message)?404:503;
    return Response.json({error:status===409?"card_conflict":status===404?"not_found":"media_unavailable"},{status,headers});
  }
}
export async function POST(request:Request){
  const headers={"cache-control":"private, no-store","x-robots-tag":"noindex"};
  let access;
  try{access=await resolveWorkerAccess(request.headers.get("x-raad-worker-key"),{RAAD_WORKER_SECRET:process.env.RAAD_WORKER_SECRET,RAAD_WORKER_ENABLED:process.env.RAAD_WORKER_ENABLED},storedWorkerConfiguration);}
  catch{return Response.json({error:"worker_unavailable"},{status:503,headers});}
  if(!access.authorized)return Response.json({error:"not_found"},{status:404,headers});
  if(!access.enabled)return Response.json({error:"worker_disabled"},{status:503,headers});
  let card;
  try{card=await readOriginalCard(request);}catch{return Response.json({error:"invalid_card"},{status:400,headers});}
  try{
    const result=await tx(async q=>{
      await q.query("SET LOCAL lock_timeout='10s'");
      await q.query("SELECT raad_gate.lock_publication_scope()");
      const article=await q.one<{status:string;image:string;source_url:string}>("SELECT status,image,source_url FROM public.articles WHERE id=$1 FOR UPDATE",[card.articleId]);
      if(!article||article.status!=="draft"||!/^https:\/\/www\.okaz\.com\.sa\/[a-z-]+\/[a-z-]+\/\d+$/.test(article.source_url)||article.image&&article.image!==card.imageName)throw Error("RAAD_CARD_CONFLICT");
      // Supabase may report a missing object as HTTP 400. Only an exclusive
      // create may reconcile that ambiguous read; putImage never overwrites.
      let existing;
      try{existing=await getImage(card.imageName);}
      catch(error){if(!(error instanceof Error)||error.message!=="Storage download failed (400)")throw error;existing=null;}
      if(existing){
        const reader=existing.body.getReader(),hash=createHash("sha256");let bytes=0,timer:ReturnType<typeof setTimeout>|undefined;
        const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("RAAD_MEDIA_TIMEOUT")),10000);});
        try{
          if((existing.size??0)>262144)throw Error("RAAD_CARD_CONFLICT");
          while(true){const part=await Promise.race([reader.read(),deadline]);if(part.done)break;bytes+=part.value.byteLength;if(bytes>262144)throw Error("RAAD_CARD_CONFLICT");hash.update(part.value);}
        }finally{clearTimeout(timer);void reader.cancel().catch(()=>{});reader.releaseLock();}
        if(hash.digest("hex")!==card.sha256)throw Error("RAAD_CARD_CONFLICT");
      }else await putImage(card.imageName,card.data,"image/png");
      if(!article.image)await q.exec("UPDATE public.articles SET image=$1,updated_at=clock_timestamp() WHERE id=$2",[card.imageName,card.articleId]);
      return {articleId:card.articleId,imageName:card.imageName,sha256:card.sha256,bytes:card.data.length};
    });
    return Response.json(result,{headers});
  }catch(error){return Response.json({error:error instanceof Error&&error.message==="RAAD_CARD_CONFLICT"?"card_conflict":"media_unavailable"},{status:error instanceof Error&&error.message==="RAAD_CARD_CONFLICT"?409:503,headers});}
}
