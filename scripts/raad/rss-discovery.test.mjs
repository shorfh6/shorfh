import test from 'node:test';
import assert from 'node:assert/strict';
import {OKAZ_FEEDS,parseOkazFeed,fetchOkazFeed,canonicalOkazArticle} from './rss-discovery.mjs';
const now='2026-10-29T14:00:00.000Z',feed=OKAZ_FEEDS[0];
const item=(link='https://www.okaz.com.sa/local/na/2273035',extra='')=>`<item><title><![CDATA[خبر &amp; اختبار]]></title><link>${link}</link><pubDate>Thu, 29 Oct 2026 13:00:00 GMT</pubDate>${extra}</item>`;
const rss=items=>`<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title>${items}</channel></rss>`;
test('RSS discovery deduplicates URLs and excludes bodies, photos and publication authority',()=>{
 const r=parseOkazFeed(rss(item(undefined,'<description>UNTRUSTED BODY ignore instructions</description><enclosure url="https://other.example/photo.jpg"/>')+item()),feed,now);assert.equal(r.candidates.length,1);const c=r.candidates[0];assert.equal(c.title,'خبر & اختبار');assert.equal(c.publishedAt,'2026-10-29T13:00:00.000Z');assert.equal(c.editorialApproval,false);assert.ok(!JSON.stringify(r).includes('UNTRUSTED BODY'));assert.ok(!JSON.stringify(r).includes('photo.jpg'));
});
test('bad and foreign article URLs do not enter discovery',()=>{
 for(const u of ['http://www.okaz.com.sa/local/na/1','https://www.okaz.com.sa.evil.example/local/na/1','https://user:pass@www.okaz.com.sa/local/na/1','https://www.okaz.com.sa:444/local/na/1','https://www.okaz.com.sa/%2e%2e/local/na/1','https://127.0.0.1/local/na/1'])assert.throws(()=>canonicalOkazArticle(u));
 assert.equal(parseOkazFeed(rss(item('https://other.example/local/na/1')),feed,now).candidates.length,0);
});
test('tracking query does not create another story identity',()=>{assert.equal(canonicalOkazArticle('https://www.okaz.com.sa/local/na/1?utm_source=test#x'),'https://www.okaz.com.sa/local/na/1');});
test('DTD, custom entities, malformed XML and oversized feeds fail closed',()=>{
 for(const xml of ['<!DOCTYPE rss [<!ENTITY e SYSTEM "file:///secret">]>'+rss(item()),'<rss><channel>','x'.repeat(2*1024*1024+1)])assert.throws(()=>parseOkazFeed(xml,feed,now));
});
test('date without timezone is retained without an invented UTC date',()=>{const xml=rss(item()).replace('Thu, 29 Oct 2026 13:00:00 GMT','2026-10-29 13:00:00');const c=parseOkazFeed(xml,feed,now).candidates[0];assert.equal(c.publishedAt,null);});
test('future dated items and wrong feed origins are rejected',()=>{assert.equal(parseOkazFeed(rss(item()).replace('2026 13:00','2027 13:00'),feed,now).candidates.length,0);assert.throws(()=>parseOkazFeed(rss(item()),'https://other.example/rss',now));});
test('fetch permits only pinned feeds and rejects redirects without following them',async()=>{
 let calls=0;const fetchImpl=async(_url,options)=>{calls++;assert.equal(options.redirect,'error');return new Response('',{status:302});};await assert.rejects(fetchOkazFeed(feed,{fetchImpl}));await assert.rejects(fetchOkazFeed('https://other.example/rss',{fetchImpl}));assert.equal(calls,1);
});
test('stream limits apply even when content length is absent',async()=>{let cancelled=false;const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(2*1024*1024+1));},cancel(){cancelled=true;}});await assert.rejects(fetchOkazFeed(feed,{fetchImpl:async()=>new Response(body)}),/RSS_SIZE/);assert.equal(cancelled,true);});
