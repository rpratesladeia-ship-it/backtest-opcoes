const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { run } = require('./backtest');
const { ema, rsi, adx } = require('./indicators');
const PORT = process.env.PORT || 3000;
const SYMBOLS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','TRXUSDT','AVAXUSDT','LINKUSDT',
  'DOTUSDT','LTCUSDT','BCHUSDT','UNIUSDT','ETCUSDT','NEARUSDT','APTUSDT','ARBUSDT','OPUSDT','ATOMUSDT',
  'ICPUSDT','FILUSDT','INJUSDT','SUIUSDT','SEIUSDT','SHIBUSDT','PEPEUSDT','AAVEUSDT','RENDERUSDT','XLMUSDT'
];
const PAPER_SECRET = process.env.PAPER_TRADE_SECRET || 'backtest-opcoes-paper-trade-v1';
function encodeTrade(trade){const payload=Buffer.from(JSON.stringify(trade)).toString('base64url');const sig=crypto.createHmac('sha256',PAPER_SECRET).update(payload).digest('base64url');return payload+'.'+sig;}
function decodeTrade(token){try{const [payload,sig]=String(token||'').split('.');if(!payload||!sig)return null;const expected=crypto.createHmac('sha256',PAPER_SECRET).update(payload).digest();const received=Buffer.from(sig,'base64url');if(received.length!==expected.length||!crypto.timingSafeEqual(received,expected))return null;const trade=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));if(!trade.id||!SYMBOLS.includes(trade.symbol)||!['CALL','PUT'].includes(trade.direction))return null;return trade;}catch{return null;}}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const intervalMs = interval => interval === '5m' ? 300000 : 60000;

async function binanceKlines(symbol, interval, total) {
  let all = [], endTime = null;
  while (all.length < total) {
    const limit = Math.min(1000, total - all.length);
    let data = null, lastErr;
    for (const host of ['https://data-api.binance.vision','https://api.binance.com']) {
      try {
        const url = `${host}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}` + (endTime ? `&endTime=${endTime}` : '');
        const r = await fetch(url, { headers: { 'Accept':'application/json','User-Agent':'backtest-opcoes/2.0' } });
        if (r.status === 418 || r.status === 429) throw new Error(`Binance HTTP ${r.status}: bloqueio temporário`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        data = await r.json(); break;
      } catch (e) { lastErr = e; }
    }
    if (!data) throw new Error(lastErr ? lastErr.message : 'Falha Binance');
    if (!Array.isArray(data) || !data.length) break;
    all = data.concat(all); endTime = data[0][0] - 1;
    if (data.length < limit) break;
    await sleep(180);
  }
  const ms = intervalMs(interval), now = Date.now();
  const candles = all.map(k => ({ t:+k[0], o:+k[1], h:+k[2], l:+k[3], c:+k[4], closed:(+k[0]+ms)<=now }))
    .filter(k => k.closed);
  return { candles, source:'Binance' };
}
async function okxKlines(symbol, interval, total) {
  const instId = symbol.replace('USDT','-USDT'), bar = interval === '5m' ? '5m' : '1m';
  let all = [], after = null;
  while (all.length < total) {
    const limit = Math.min(300,total-all.length), url = new URL('https://www.okx.com/api/v5/market/candles');
    url.searchParams.set('instId',instId); url.searchParams.set('bar',bar); url.searchParams.set('limit',String(limit));
    if (after) url.searchParams.set('after',String(after));
    const r = await fetch(url,{headers:{'Accept':'application/json','User-Agent':'backtest-opcoes/2.0'}});
    if (!r.ok) throw new Error(`OKX HTTP ${r.status}`);
    const payload = await r.json();
    if (payload.code !== '0' || !Array.isArray(payload.data)) throw new Error(payload.msg || 'Resposta inválida OKX');
    if (!payload.data.length) break;
    all=all.concat(payload.data);
    after=Math.min(...payload.data.map(k=>+k[0]))-1;
    if (payload.data.length<limit) break;
    await sleep(100);
  }
  const candles=all.filter(k=>k[8]==='1').map(k=>({t:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4]}))
    .sort((a,b)=>a.t-b.t);
  const unique=candles.filter((k,i)=>i===0||k.t!==candles[i-1].t).slice(-total);
  if(unique.length<Math.min(total,100)) throw new Error(`OKX retornou apenas ${unique.length} candles fechados`);
  return {candles:unique,source:'OKX'};
}
async function klines(symbol,interval,total){
  try{return await binanceKlines(symbol,interval,total);}
  catch(binanceError){try{return await okxKlines(symbol,interval,total);}
    catch(okxError){throw new Error(`Binance: ${binanceError.message}; OKX: ${okxError.message}`);}}
}
const num=(v,d)=>v!==null&&v!==''&&Number.isFinite(+v)?+v:d;
function params(q){return{expiry:Math.max(1,Math.min(10,num(q.get('expiry'),1))),payout:Math.max(1,Math.min(100,num(q.get('payout'),85))),adxMin:num(q.get('adxMin'),20),rsiLow:num(q.get('rsiLow'),40),rsiHigh:num(q.get('rsiHigh'),60)};}
function signalFor(candles,P){
  if(candles.length<80)return null;
  const c=candles.map(x=>x.c),h=candles.map(x=>x.h),l=candles.map(x=>x.l);
  const i=c.length-1,ef=ema(c,20),es=ema(c,50),R=rsi(c,14),A=adx(h,l,c,14);
  if(ef[i]==null||es[i]==null||R[i]==null||A[i]==null)return null;
  let direction=null;
  if(ef[i]>es[i]&&A[i]>=P.adxMin&&R[i]<=P.rsiLow)direction='CALL';
  else if(ef[i]<es[i]&&A[i]>=P.adxMin&&R[i]>=P.rsiHigh)direction='PUT';
  if(!direction)return null;
  return {direction,rsi:+R[i].toFixed(2),adx:+A[i].toFixed(2),ema20:+ef[i].toFixed(8),ema50:+es[i].toFixed(8),signalCandleTime:candles[i].t};
}
function json(res,code,obj){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj));}
function readBody(req){return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{try{resolve(JSON.parse(raw||'{}'));}catch(e){reject(e);}});req.on('error',reject);});}
async function handle(req,res){
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/api/health')return json(res,200,{ok:true,symbols:SYMBOLS,providers:['Binance','OKX'],mode:'paper-only'});
 if(u.pathname==='/api/scan'&&req.method==='GET'){
  const q=u.searchParams,interval=['1m','5m'].includes(q.get('interval'))?q.get('interval'):'1m';
  const total=Math.max(500,Math.min(num(q.get('candles'),1000),10000)),P=params(q);
  const results=new Array(SYMBOLS.length);let cursor=0;
  async function worker(){while(true){const idx=cursor++;if(idx>=SYMBOLS.length)return;const symbol=SYMBOLS[idx];
    try{const data=await klines(symbol,interval,total),bt=run(data.candles,P),signal=signalFor(data.candles,P);
      results[idx]={symbol,interval,fonteDados:data.source,candles:data.candles.length,teste:bt.teste,treino:bt.treino,signal};}
    catch(e){results[idx]={symbol,erro:e.message};}
  }}
  await Promise.all([worker(),worker(),worker(),worker()]);
  const valid=results.filter(x=>!x.erro&&x.teste);
  const excluded=new Set((q.get('exclude')||'').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean));
  const candidates=valid.filter(x=>x.signal&&x.teste.entradas>=5&&!excluded.has(x.symbol));
  candidates.sort((a,b)=>{
    const edge=(b.teste.esperancaPorEntrada||0)-(a.teste.esperancaPorEntrada||0);
    if(Math.abs(edge)>0.000001)return edge;
    return b.signal.signalCandleTime-a.signal.signalCandleTime;
  });
  const best=candidates[0]||null;
  return json(res,200,{interval,symbols:SYMBOLS,results,best:best?{symbol:best.symbol,direction:best.signal.direction,fonteDados:best.fonteDados,candles:best.candles,signal:best.signal,teste:best.teste}:null,
    message:best?'Candidato com sinal atual encontrado. Confirme os dados e use somente a operação virtual.':'Nenhum sinal atual passou pelos filtros. Não force uma operação.',resultsCount:valid.length,candidates:candidates.length,mode:'paper-only'});
 }
 if(u.pathname==='/api/paper/open'&&req.method==='POST'){
  const body=await readBody(req),symbol=String(body.symbol||'').toUpperCase(),direction=body.direction;
  const interval=['1m','5m'].includes(body.interval)?body.interval:'1m',expiry=Math.max(1,Math.min(10,num(body.expiry,1))),payout=Math.max(1,Math.min(100,num(body.payout,85)));
  if(!SYMBOLS.includes(symbol)||!['CALL','PUT'].includes(direction))return json(res,400,{error:'Ativo ou direção inválidos.'});
  const data=await klines(symbol,interval,120),last=data.candles[data.candles.length-1];
  if(!last)return json(res,502,{error:'Sem candle fechado para iniciar a simulação.'});
  const ms=intervalMs(interval),targetOpen=last.t+expiry*ms,settleAt=targetOpen+ms;
  const stake=Math.max(1,Math.min(1000,num(body.stake,5))),g1Enabled=body.g1Enabled===true;
  const trade={symbol,direction,interval,expiry,payout,entry:last.c,entryCandleTime:last.t,targetOpen,settleAt,source:data.source,status:'OPEN',createdAt:Date.now(),stake,g1Enabled,recovery:false,maxRecoveryMultiplier:2,targetExtra:stake*0.10};
  trade.id=encodeTrade(trade);
  return json(res,200,{...trade,virtual:true,message:'Operação virtual aberta. O identificador assinado permite recuperar a simulação mesmo após reinício do servidor.'});
 }
 if(u.pathname==='/api/paper/recovery'&&req.method==='POST'){
  const body=await readBody(req),parent=decodeTrade(body.id);
  if(!parent||parent.recovery||!parent.g1Enabled)return json(res,400,{error:'Recuperação G1 não permitida.'});
  const settled=await klines(parent.symbol,parent.interval,Math.min(200,parent.expiry+5));
  const target=settled.candles.find(c=>c.t===parent.targetOpen);
  if(!target)return json(res,409,{error:'O candle da primeira entrada ainda não está disponível.'});
  const result=target.c===parent.entry?'TIE':(parent.direction==='CALL'?(target.c>parent.entry?'WIN':'LOSS'):(target.c<parent.entry?'WIN':'LOSS'));
  if(result!=='LOSS')return json(res,409,{error:'A primeira entrada não terminou em LOSS; G1 não será aberta.'});
  const stake=Math.ceil(((parent.stake+parent.targetExtra)/(parent.payout/100))*100)/100;
  if(stake>parent.stake*2)return json(res,409,{error:'G1 ultrapassaria o limite de 2x. Ciclo encerrado.',recoveryBlocked:true});
  const data=await klines(parent.symbol,parent.interval,120),last=data.candles[data.candles.length-1];
  const ms=intervalMs(parent.interval),targetOpen=last.t+parent.expiry*ms;
  const trade={symbol:parent.symbol,direction:parent.direction,interval:parent.interval,expiry:parent.expiry,payout:parent.payout,entry:last.c,entryCandleTime:last.t,targetOpen,settleAt:targetOpen+ms,source:data.source,status:'OPEN',createdAt:Date.now(),stake,g1Enabled:false,recovery:true,parentId:parent.id,maxRecoveryMultiplier:2,targetExtra:parent.targetExtra};
  trade.id=encodeTrade(trade);
  return json(res,200,{...trade,virtual:true,message:'G1 virtual aberta automaticamente; nenhuma ordem real foi enviada.'});
 }
 if(u.pathname==='/api/paper/status'&&req.method==='GET'){
  const id=u.searchParams.get('id'),trade=decodeTrade(id);
  if(!trade)return json(res,404,{error:'Identificador da operação inválido ou incompleto.'});
  const result={...trade,virtual:true,remainingMs:Math.max(0,trade.settleAt-Date.now())};
  if(Date.now()>=trade.settleAt){
    try{const data=await klines(trade.symbol,trade.interval,Math.min(200,trade.expiry+5));
      const target=data.candles.find(c=>c.t===trade.targetOpen);
      if(target){result.exit=target.c;result.exitCandleTime=target.t;result.status='SETTLED';
        result.result=target.c===trade.entry?'TIE':(trade.direction==='CALL'?(target.c>trade.entry?'WIN':'LOSS'):(target.c<trade.entry?'WIN':'LOSS'));
        result.pnl=result.result==='WIN'?trade.stake*trade.payout/100:result.result==='LOSS'?-trade.stake:0;result.settledAt=Date.now();result.settlementSource=data.source;
        if(result.result==='LOSS'&&trade.g1Enabled&&!trade.recovery){const required=Math.ceil(((trade.stake+trade.targetExtra)/(trade.payout/100))*100)/100;result.recoveryStake=required<=trade.stake*2?required:null;result.recoveryBlocked=required>trade.stake*2;}}
      else result.lastError='O candle de expiração ainda não foi disponibilizado pela fonte de dados.';
    }catch(e){result.lastError=e.message;}
  }
  return json(res,200,result);
 }
 if(u.pathname==='/api/backtest'&&req.method==='GET'){
  const q=u.searchParams,interval=['1m','5m'].includes(q.get('interval'))?q.get('interval'):'1m';
  const total=Math.max(500,Math.min(num(q.get('candles'),5000),10000)),P=params(q);
  const symbol=(q.get('symbol')||'BTCUSDT').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const data=await klines(symbol,interval,total);
  return json(res,200,{symbol,interval,fonteDados:data.source,...run(data.candles,P)});
 }
 const file=path.join(__dirname,'public','index.html');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store, no-cache, must-revalidate, proxy-revalidate','Pragma':'no-cache','Expires':'0'});fs.createReadStream(file).pipe(res);
}
const server=http.createServer((req,res)=>{handle(req,res).catch(e=>json(res,502,{error:e.message}));});
server.listen(PORT,()=>console.log('Backtest Opções scanner 30 ativos / modo virtual na porta '+PORT));
