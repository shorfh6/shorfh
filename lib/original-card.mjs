import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';

function invalid(){throw Error('RAAD_CARD_INVALID');}
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(data){let crc=0xffffffff;for(const byte of data)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}

// Validate the complete static PNG, not just attacker-controlled IHDR bytes.
// Original cards use non-interlaced PNG; bound inflation to the exact scanlines.
function validatePng(data){
  if(data.length<57||!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))invalid();
  let offset=8,header=false,palette=false,idat=false,endedIdat=false,ended=false,rowBytes=0;
  const compressed=[];
  while(offset<data.length){
    if(offset+12>data.length)invalid();
    const length=data.readUInt32BE(offset),end=offset+12+length;
    if(end>data.length)invalid();
    const type=data.toString('latin1',offset+4,offset+8),chunk=data.subarray(offset+8,end-4);
    if(!/^[A-Za-z]{4}$/.test(type)||type[2]!==type[2].toUpperCase()||crc32(data.subarray(offset+4,end-4))!==data.readUInt32BE(end-4))invalid();
    if(!header&&type!=='IHDR')invalid();
    if(type==='IHDR'){
      if(header||length!==13||chunk.readUInt32BE(0)!==1200||chunk.readUInt32BE(4)!==675)invalid();
      const depth=chunk[8],color=chunk[9],depths={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
      if(!depths[color]?.includes(depth)||chunk[10]!==0||chunk[11]!==0||chunk[12]!==0)invalid();
      rowBytes=Math.ceil(1200*({0:1,2:3,3:1,4:2,6:4}[color])*depth/8);
      header=true;
    }else if(type==='PLTE'){
      if(palette||idat||!length||length%3||length>768||[0,4].includes(data[25])||(data[25]===3&&length/3>2**data[24]))invalid();
      palette=true;
    }else if(type==='IDAT'){
      if(endedIdat||(data[25]===3&&!palette))invalid();
      idat=true;compressed.push(chunk);
    }else if(type==='IEND'){
      if(length||!idat||end!==data.length)invalid();
      ended=true;
    }else{
      if(type[0]===type[0].toUpperCase()||['acTL','fcTL','fdAT'].includes(type))invalid();
    }
    if(idat&&type!=='IDAT')endedIdat=true;
    offset=end;
  }
  if(!ended)invalid();
  const expected=(rowBytes+1)*675;
  const input=Buffer.concat(compressed),inflated=inflateSync(input,{maxOutputLength:expected,info:true});
  if(inflated.buffer.length!==expected||inflated.engine.bytesWritten!==input.length)invalid();
  for(let row=0;row<675;row++)if(inflated.buffer[row*(rowBytes+1)]>4)invalid();
}

export async function readOriginalCard(request){
  if(request.headers.get('content-type')?.split(';')[0]!=='image/png')throw Error('RAAD_CARD_INVALID');
  const id=request.headers.get('x-raad-article-id');
  if(!/^[1-9]\d{0,9}$/.test(id??'')||!Number.isSafeInteger(Number(id))||Number(id)>2147483647)throw Error('RAAD_CARD_INVALID');
  if(Number(request.headers.get('content-length'))>262144||!request.body)throw Error('RAAD_CARD_INVALID');
  const reader=request.body.getReader(),parts=[];let bytes=0,timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('RAAD_CARD_INVALID')),10000);});
  try{while(true){const chunk=await Promise.race([reader.read(),deadline]);if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>262144)throw Error('RAAD_CARD_INVALID');parts.push(chunk.value);}}
  finally{clearTimeout(timer);void reader.cancel().catch(()=>{});reader.releaseLock();}
  const data=Buffer.concat(parts);
  validatePng(data);
  const sha256=createHash('sha256').update(data).digest('hex'),articleId=Number(id);
  return {articleId,data,sha256,imageName:`raad-${articleId}-${sha256.slice(0,24)}.png`};
}
