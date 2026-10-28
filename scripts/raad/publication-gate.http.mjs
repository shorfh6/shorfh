import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import pg from 'pg';

const project=path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')),'..','..');
const endpoint='postgresql://raad_test@127.0.0.1:55439/raad_gate_test';
assert.equal(process.argv[2],'--execute-isolated-http');
const playwright=process.argv[3];assert.ok(path.isAbsolute(playwright),'Explicit installed Playwright module required');
const {chromium}=await import(pathToFileURL(playwright).href);
const pool=new pg.Pool({connectionString:endpoint,max:3,connectionTimeoutMillis:2000,statement_timeout:5000});
const testRoot=path.join(os.tmpdir(),'opencode');assert.equal(fs.statSync(testRoot).isDirectory(),true);
const temp=fs.mkdtempSync(path.join(testRoot,'raad-gate-http-'));
const port=3303,base=`http://127.0.0.1:${port}`;
let server,browser,current='preflight';const passed=[];
const test=async(name,fn)=>{current=name;await fn();passed.push(name);};
try{
  const {rows:[identity]}=await pool.query("SELECT current_database() AS db,current_setting('data_directory') AS dir");
  assert.equal(identity.db,'raad_gate_test');assert.match(identity.dir.replaceAll('\\','/'),/\/Temp\/opencode\/raad-pg-data$/i);
  assert.equal((await pool.query('SELECT version FROM raad_gate.installation WHERE singleton')).rows[0].version,1);
  await pool.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='raad_gate_web_test') THEN CREATE ROLE raad_gate_web_test LOGIN INHERIT; END IF; END $$; GRANT raad_gate_publisher TO raad_gate_web_test");
  const {rows:[role]}=await pool.query("SELECT rolsuper,rolcreaterole,rolcreatedb,rolbypassrls FROM pg_roles WHERE rolname='raad_gate_web_test'");
  assert.deepEqual(role,{rolsuper:false,rolcreaterole:false,rolcreatedb:false,rolbypassrls:false});
  const unique=randomUUID(),email=`synthetic-http-${unique}@invalid.example`,password='SYNTHETIC-LOCAL-LOGIN-ONLY-2026';
  const salt=randomBytes(16).toString('hex'),passwordHash=`scrypt$${salt}$${scryptSync(password,salt,64).toString('hex')}`;
  await pool.query("INSERT INTO public.users(name,email,password_hash,role) VALUES($1,$2,$3,'editor')",['SYNTHETIC HTTP Editor',email,passwordHash]);
  const {rows:[category]}=await pool.query('INSERT INTO public.categories(name,slug) VALUES($1,$2) RETURNING *',['SYNTHETIC HTTP '+unique,'synthetic-http-'+unique]);
  // Source-only isolated copy. No .env, data, credentials, journal or Git copy.
  for(const name of ['app','components','lib','public'])fs.cpSync(path.join(project,name),path.join(temp,name),{recursive:true});
  for(const name of ['package.json','tsconfig.json','next.config.mjs'])fs.copyFileSync(path.join(project,name),path.join(temp,name));
  fs.writeFileSync(path.join(temp,'package-lock.json'),JSON.stringify({name:'synthetic-local-http-test',lockfileVersion:3,packages:{}}));
  fs.symlinkSync(path.join(project,'node_modules'),path.join(temp,'node_modules'),'junction');
  const env=Object.fromEntries(['PATH','SystemRoot','WINDIR','USERPROFILE','HOMEDRIVE','HOMEPATH','TEMP','TMP','ComSpec','PATHEXT','NUMBER_OF_PROCESSORS'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  Object.assign(env,{NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',DATABASE_URL:'postgresql://raad_gate_web_test@127.0.0.1:55439/raad_gate_test?sslmode=disable',DATABASE_SSL:'false',SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:'',SITE_URL:base});
  let output='',exited=false;
  server=spawn(process.execPath,[path.join(project,'node_modules','next','dist','bin','next'),'dev','--webpack','--hostname','127.0.0.1','--port',String(port)],{cwd:temp,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
  for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>{output+=chunk.toString();if(output.length>2*1024*1024)output=output.slice(-1024*1024);});
  server.on('exit',()=>{exited=true;});
  const started=Date.now();while(!/Ready in/.test(output)){if(exited||Date.now()-started>90000)throw Error('ISOLATED_NEXT_START_FAILED');await new Promise(r=>setTimeout(r,250));}
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext();
  await context.route('**/*',route=>{const u=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(u.hostname)?route.continue():route.abort();});
  const page=await context.newPage();page.setDefaultTimeout(30000);
  await page.goto(base+'/admin/login');
  await page.locator('input[name="email"]').fill(email);await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button',{name:'دخول',exact:true}).click();await page.waitForURL(base+'/admin');
  await page.goto(base+'/admin/articles/new');
  const title='SYNTHETIC HTTP '+unique;
  await page.locator('input[name="title"]').fill(title);
  await page.locator('textarea[name="excerpt"]').fill('SYNTHETIC description');
  await page.locator('textarea[name="body"]').fill('SYNTHETIC NOT REAL NEWS https://example.com/source');
  await page.locator('select[name="category"]').selectOption(String(category.id));
  await page.locator('input[type="file"]').setInputFiles(path.join(project,'docs','raad','media','shurfa-alula-lasersetI-illustration.png'));
  await page.getByRole('button',{name:'حفظ',exact:true}).click();
  await page.waitForURL(/\/admin\/articles\/\d+\?m=created/);
  const id=Number(new URL(page.url()).pathname.split('/').at(-1));
  await test('authenticated server action creates only a draft',async()=>{assert.equal((await pool.query('SELECT status FROM public.articles WHERE id=$1',[id])).rows[0].status,'draft');});
  await test('publish form rejects unapproved draft and leaves it unchanged',async()=>{
    await page.getByRole('button',{name:'نشر النسخة المعتمدة',exact:true}).first().click();
    await page.getByText('لا يمكن النشر قبل تسجيل اعتماد المعتمد لهذه النسخة.',{exact:true}).waitFor();
    assert.equal((await pool.query('SELECT status FROM public.articles WHERE id=$1',[id])).rows[0].status,'draft');
  });
  const mediaHash=createHash('sha256').update(fs.readFileSync(path.join(project,'docs','raad','media','shurfa-alula-lasersetI-illustration.png'))).digest('hex');
  await pool.query('SELECT raad_gate.record_approval($1,raad_gate.article_snapshot($1),$2,$3,$4,clock_timestamp(),$5::jsonb,3600)',[id,'a'.repeat(64),'b'.repeat(64),'c'.repeat(64),JSON.stringify({final_agent:'al-mutamid',decision:'APPROVED',agents:['al-muhaqqiq','al-muharrir','al-musawwir'],media_sha256:mediaHash,site:base,synthetic:true})]);
  await test('approved publish verifies image bytes and commits publication',async()=>{
    await page.getByRole('button',{name:'نشر النسخة المعتمدة',exact:true}).first().click();await page.waitForURL(/\?m=saved/);
    assert.equal((await pool.query('SELECT status FROM public.articles WHERE id=$1',[id])).rows[0].status,'published');
  });
  await test('editing live text without reapproval is refused and old content remains public',async()=>{
    await page.locator('textarea[name="body"]').fill('SYNTHETIC unreviewed edit');await page.getByRole('button',{name:'حفظ',exact:true}).click();
    await page.getByText('هذه مادة منشورة؛ حوّلها صراحة إلى مسودة قبل تعديلها، ثم أعد اعتماد النسخة الجديدة.',{exact:true}).waitFor();
    const row=(await pool.query('SELECT body,status FROM public.articles WHERE id=$1',[id])).rows[0];assert.equal(row.body,'SYNTHETIC NOT REAL NEWS https://example.com/source');assert.equal(row.status,'published');
  });
  console.log(JSON.stringify({synthetic:true,host:base,passed:passed.length,failed:0,tests:passed,isolatedSourceCopy:temp,privateEnvironmentCopied:false,productionTouched:false}));
}catch(error){console.log(JSON.stringify({synthetic:true,passed:passed.length,failed:1,failedTest:current,code:error.code??error.name,message:error.message}));process.exitCode=1;}
finally{await browser?.close();if(server&&!server.killed)server.kill();await pool.end();}
