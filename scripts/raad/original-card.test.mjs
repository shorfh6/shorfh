import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {readOriginalCard} from '../../lib/original-card.mjs';

function request(data,headers={}){return new Request('https://site.example/api/raad/media',{method:'POST',headers:{'content-type':'image/png','x-raad-article-id':'54',...headers},body:data,...(data instanceof ReadableStream?{duplex:'half'}:{})});}
function crc32(data){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}return (crc^0xffffffff)>>>0;}
function chunk(type,data=Buffer.alloc(0)){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,-4)),b.length-4);return b;}
function png({width=1200,height=675,depth=8,color=6,interlace=0,raw=Buffer.alloc(675*(1200*4+1)),extra=[],tail=Buffer.alloc(0),compressed=deflateSync(raw)}={}){const h=Buffer.alloc(13);h.writeUInt32BE(width);h.writeUInt32BE(height,4);h[8]=depth;h[9]=color;h[12]=interlace;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),...extra,chunk('IDAT',compressed),chunk('IEND'),tail]);}

test('card identity binds article ID and all exact bytes for retry reconciliation',async()=>{
  const data=png(),a=await readOriginalCard(request(data)),b=await readOriginalCard(request(data));
  assert.equal(a.imageName,b.imageName);assert.equal(a.sha256,createHash('sha256').update(data).digest('hex'));assert.equal(a.articleId,54);
  assert.match(a.imageName,/^raad-54-[a-f0-9]{24}\.png$/);assert.deepEqual(a.data,data);
  const c=await readOriginalCard(request(data,{'x-raad-article-id':'55'}));assert.notEqual(a.imageName,c.imageName);
  const raw=Buffer.alloc(675*4801);raw[1]=1;assert.notEqual((await readOriginalCard(request(png({raw})))).imageName,a.imageName);
});
test('card input rejects wrong type and unsafe or noncanonical IDs',async()=>{
  for(const headers of [{'content-type':'image/svg+xml'},{'x-raad-article-id':'54 OR 1=1'},{'x-raad-article-id':'2147483648'},{'x-raad-article-id':'0'},{'x-raad-article-id':'01'},{'x-raad-article-id':'-1'}])await assert.rejects(readOriginalCard(request(png(),headers)));
  assert.equal((await readOriginalCard(request(png(),{'x-raad-article-id':'2147483647'}))).articleId,2147483647);
});
test('card requires real complete PNG rather than forged dimensions',async()=>{
  const fake=Buffer.alloc(45);Buffer.from([137,80,78,71,13,10,26,10]).copy(fake);fake.write('IHDR',12);fake.writeUInt32BE(1200,16);fake.writeUInt32BE(675,20);
  for(const b of [fake,Buffer.from('not png'),png().subarray(0,-1),png({width:1201}),png({height:674}),png({tail:Buffer.from('trailing')})])await assert.rejects(readOriginalCard(request(b)));
});
test('PNG validates CRC, chunk boundaries, critical chunks and static format',async()=>{
  const corrupt=png();corrupt[29]^=1;
  const oversizedChunk=png();oversizedChunk.writeUInt32BE(0xffffffff,33);
  for(const b of [corrupt,oversizedChunk,png({extra:[chunk('IHDR',Buffer.alloc(13))]}),png({extra:[chunk('FAKE')]}),png({extra:[chunk('acTL',Buffer.alloc(8))]}),png({interlace:1}),png({depth:3}),png({color:7}),png({color:3})])await assert.rejects(readOriginalCard(request(b)));
});
test('PNG inflation is bounded and checks exact scanline length, filters and zlib completion',async()=>{
  const badFilter=Buffer.alloc(675*4801);badFilter[4801]=5;
  for(const options of [{compressed:Buffer.from('not zlib')},{compressed:Buffer.concat([deflateSync(Buffer.alloc(675*4801)),Buffer.from('tail')])},{raw:Buffer.alloc(675*4801+1)},{raw:Buffer.alloc(675*4801-1)},{raw:badFilter}])await assert.rejects(readOriginalCard(request(png(options))));
});
test('accepts common grayscale, RGB and RGBA PNG scanlines',async()=>{
  for(const [color,channels] of [[0,1],[2,3],[4,2],[6,4]])await readOriginalCard(request(png({color,raw:Buffer.alloc(675*(1200*channels+1))})));
});
test('card upload enforces byte limit independent of declared length',async()=>{
  await assert.rejects(readOriginalCard(request(Buffer.alloc(262145))));
  await assert.rejects(readOriginalCard(request(png(),{'content-length':'262145'})));
  await assert.rejects(readOriginalCard(request(Buffer.alloc(262145),{'content-length':'1'})));
});
test('streamed upload enforces aggregate limit and cancels without awaiting hostile cancellation',async()=>{
  let canceled=false;
  const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(200000));c.enqueue(new Uint8Array(62145));},cancel(){canceled=true;return new Promise(()=>{});}});
  await assert.rejects(readOriginalCard(request(stream)));assert.equal(canceled,true);
});
test('valid chunked PNG upload retains exact identity',async()=>{
  const data=png(),stream=new ReadableStream({start(c){for(let i=0;i<data.length;i+=37)c.enqueue(data.subarray(i,i+37));c.close();}});
  assert.equal((await readOriginalCard(request(stream))).sha256,createHash('sha256').update(data).digest('hex'));
});
test('stream errors and missing body fail closed',async()=>{
  await assert.rejects(readOriginalCard(request(new ReadableStream({start(c){c.error(Error('synthetic transport failure'));}}))));
  await assert.rejects(readOriginalCard(request(undefined)));
});
test('upload deadline is effective even when stream cancellation never resolves',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let canceled=false;
  const pending=readOriginalCard(request(new ReadableStream({cancel(){canceled=true;return new Promise(()=>{});}})));
  t.mock.timers.tick(10001);await assert.rejects(pending);assert.equal(canceled,true);
});
