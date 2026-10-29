export type PublicationJob={
  id:string;articleId:number;approvalId:string;snapshotHash:string;state:string;
  attempts:number;fence:string;leaseUntil:string|null;availableAt:string;
  lastError:string|null;receipt:Record<string,unknown>|null;
};
export function workerAuthorized(value:unknown,secret:unknown):boolean;
export function runPublicationTick(adapter:{
  claim(worker:string):Promise<PublicationJob|null>;
  publish(job:PublicationJob,worker:string):Promise<PublicationJob>;
  fail(job:PublicationJob,worker:string,reason:string):Promise<PublicationJob>;
  uncertain(job:PublicationJob,worker:string):Promise<PublicationJob>;
},worker?:string):Promise<PublicationJob|{state:string;id?:string}>;
