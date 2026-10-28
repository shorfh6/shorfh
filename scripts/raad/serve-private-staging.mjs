import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const projectRef='eotfvclpiflwikvqzhqt';
const reject=()=>{throw new Error('PRIVATE_STAGING_CONFIGURATION_REQUIRED');};

export function privateStagingConfiguration(env){
  let database,site,login;
  try{database=new URL(env.DATABASE_URL);site=new URL(env.SITE_URL);login=decodeURIComponent(database.username);}catch{reject();}
  if(env.NODE_ENV!=='production'||!['postgres:','postgresql:'].includes(database.protocol)||
      login!=='raad_stage_web.'+projectRef||database.hostname!=='aws-0-ap-northeast-2.pooler.supabase.com'||database.pathname!=='/postgres'||(database.port&&database.port!=='5432')||
      site.protocol!=='https:'||!/^shorfh-raad-staging(?:-[a-z0-9]+)?\.onrender\.com$/.test(site.hostname)||
      site.username||site.password||site.port||site.search||site.hash||site.pathname!=='/')reject();
  const user=env.STAGING_AUTH_USER,password=env.STAGING_AUTH_PASSWORD,port=Number(env.PORT||10000);
  if(typeof user!=='string'||!/^[a-zA-Z0-9._-]{3,40}$/.test(user)||typeof password!=='string'||password.length<32||password.length>256||!Number.isSafeInteger(port)||port<1||port>65535)reject();
  return {origin:site.origin,port,authorization:Buffer.from('Basic '+Buffer.from(user+':'+password).toString('base64'))};
}

export function hasStagingAccess(value,configuration){
  return typeof value==='string'&&Buffer.byteLength(value)===configuration.authorization.length&&timingSafeEqual(Buffer.from(value),configuration.authorization);
}

export function isPublicStagingHealth(request){return request.method==='GET'&&request.url==='/api/health';}

export async function servePrivateStaging(args=process.argv.slice(2)){
  if(args.length!==1||args[0]!=='--execute-private-staging')throw new Error('EXPLICIT_PRIVATE_STAGING_ARGUMENT_REQUIRED');
  const configuration=privateStagingConfiguration(process.env);
  for(const file of ['.env','.env.local','.env.production','.env.production.local'])if(fs.existsSync(path.resolve(file)))throw new Error('PRIVATE_STAGING_REQUIRES_ENVIRONMENT_ONLY');
  const {default:next}=await import('next');
  const app=next({dev:false,hostname:'0.0.0.0',port:configuration.port});
  await app.prepare();
  const handle=app.getRequestHandler();
  const server=createServer((request,response)=>{
    response.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
    response.setHeader('Cache-Control','private, no-store');
    if(!isPublicStagingHealth(request)&&!hasStagingAccess(request.headers.authorization,configuration)){
      response.statusCode=401;response.setHeader('WWW-Authenticate','Basic realm="RAAD private staging"');response.end('Private staging');return;
    }
    Promise.resolve(handle(request,response)).catch(()=>{
      if(!response.headersSent)response.statusCode=500;
      response.end('Staging request failed');console.error('PRIVATE_STAGING_REQUEST_FAILED');
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(configuration.port,'0.0.0.0',resolve);});
  console.log(JSON.stringify({event:'private-staging-ready',projectRef,origin:configuration.origin,port:configuration.port}));
  const shutdown=()=>{server.close(()=>{app.close().finally(()=>process.exit(0));});};
  process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
  return server;
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  servePrivateStaging().catch(()=>{console.error('PRIVATE_STAGING_START_FAILED');process.exitCode=1;});
}
