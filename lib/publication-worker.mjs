import {randomBytes,timingSafeEqual} from 'node:crypto';

export function workerAuthorized(value,secret){
  if(typeof secret!=='string'||secret.length<32||secret.length>256||typeof value!=='string')return false;
  const expected=Buffer.from(secret),actual=Buffer.from(value);
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
}

// One bounded tick. The queue and transaction adapter supply persistent authority;
// this module performs no I/O, starts no timer, and never creates an approval.
export async function runPublicationTick(adapter,worker=randomBytes(32).toString('hex')){
  if(!/^[a-f0-9]{64}$/.test(worker))throw Error('RAAD_QUEUE_ARGUMENTS');
  const job=await adapter.claim(worker);
  if(!job)return{state:'idle'};
  try{return await adapter.publish(job,worker);}
  catch(error){
    const message=error instanceof Error?error.message:'';
    if(message==='RAAD_QUEUE_STALE_LEASE')return{state:'lease_lost',id:job.id};
    let reason;
    if(message==='RAAD_MEDIA_CHANGED')reason='media_unavailable';
    else if(['RAAD_APPROVAL_STALE','RAAD_APPROVAL_REQUIRED','RAAD_SITE_URL_INVALID','RAAD_QUEUE_APPROVAL_STALE'].includes(message))reason='stale_approval';
    try{return reason?await adapter.fail(job,worker,reason):await adapter.uncertain(job,worker);}
    catch{return{state:'uncertain',id:job.id};}
  }
}
