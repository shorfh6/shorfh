import test from 'node:test';
import assert from 'node:assert/strict';
import {privateStagingConfiguration,hasStagingAccess,isPublicStagingHealth} from './serve-private-staging.mjs';

const env=()=>({NODE_ENV:'production',DATABASE_URL:'postgresql://raad_stage_web.eotfvclpiflwikvqzhqt:SYNTHETIC@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres',SITE_URL:'https://shorfh-raad-staging.onrender.com',STAGING_AUTH_USER:'raad-preview',STAGING_AUTH_PASSWORD:'SYNTHETIC-PRIVATE-PREVIEW-NOT-A-REAL-SECRET',PORT:'10000'});

test('private staging configuration pins the database identity and HTTPS preview origin',()=>{
  const configuration=privateStagingConfiguration(env());assert.equal(configuration.origin,'https://shorfh-raad-staging.onrender.com');assert.equal(configuration.port,10000);
  assert.equal(privateStagingConfiguration({...env(),SITE_URL:'https://shorfh-raad-staging-a123.onrender.com'}).port,10000);
});
test('exact configured Basic authentication is accepted',()=>{
  const source=env(),configuration=privateStagingConfiguration(source);
  const header='Basic '+Buffer.from(source.STAGING_AUTH_USER+':'+source.STAGING_AUTH_PASSWORD).toString('base64');assert.equal(hasStagingAccess(header,configuration),true);
});
test('missing malformed or incorrect authorization is refused',()=>{
  const configuration=privateStagingConfiguration(env());
  for(const header of [undefined,null,[], '', 'Bearer SYNTHETIC','Basic invalid','Basic '+Buffer.from('raad-preview:incorrect-password').toString('base64')])assert.equal(hasStagingAccess(header,configuration),false);
});
test('production site and non-staging database identities cannot use this server',()=>{
  for(const change of [{SITE_URL:'https://www.shurfh.com'},{SITE_URL:'http://shorfh-raad-staging.onrender.com'},{SITE_URL:'https://shorfh-raad-staging.onrender.com/extra'},{DATABASE_URL:'postgresql://postgres@aws-0-ap-northeast-2.pooler.supabase.com/postgres'},{DATABASE_URL:env().DATABASE_URL.replace('eotfvclpiflwikvqzhqt','edfbsgnrsbbjngbudpfk')},{DATABASE_URL:env().DATABASE_URL.replace('aws-0-ap-northeast-2.pooler.supabase.com','other.invalid.example')}])assert.throws(()=>privateStagingConfiguration({...env(),...change}),/^Error: PRIVATE_STAGING_CONFIGURATION_REQUIRED$/);
});
test('unconfigured weak or invalid preview settings fail closed',()=>{
  for(const change of [{STAGING_AUTH_USER:''},{STAGING_AUTH_PASSWORD:''},{STAGING_AUTH_PASSWORD:'short'},{NODE_ENV:'development'},{PORT:'0'},{PORT:'not-a-port'},{DATABASE_URL:'SYNTHETIC private configuration text'}])assert.throws(()=>privateStagingConfiguration({...env(),...change}),/^Error: PRIVATE_STAGING_CONFIGURATION_REQUIRED$/);
});
test('only the exact read-only GET health path is public',()=>{
  assert.equal(isPublicStagingHealth({method:'GET',url:'/api/health'}),true);
  for(const request of [{method:'POST',url:'/api/health'},{method:'GET',url:'/admin'},{method:'GET',url:'/api/health?extra=1'},{method:'GET',url:'/api/health/../admin'},{method:'GET',url:'/%61pi/health'}])assert.equal(isPublicStagingHealth(request),false);
});
