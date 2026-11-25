const { ema, rsi, adx } = require('./indicators');

const DEFAULTS = { emaFast: 20, emaSlow: 50, adxMin: 20, rsiLow: 40, rsiHigh: 60, expiry: 1, payout: 85 };
const TRAINING_GRID = [{emaFast:10,emaSlow:40},{emaFast:20,emaSlow:50},{emaFast:30,emaSlow:60}];

function wilson(w, n) {
  if (!n) return [0, 1];
  const z=1.96,p=w/n,d=1+z*z/n,c=p+z*z/(2*n),m=z*Math.sqrt((p*(1-p)+z*z/(4*n))/n);
  return [(c-m)/d,(c+m)/d];
}

// Reamostragem em blocos contíguos para reduzir o otimismo de tratar sinais próximos como independentes.
function blockBootstrap(trades, blockLength=5, reps=500) {
  const seq=trades.filter(t=>t.r!=='T').map(t=>t.r==='W'?1:0),n=seq.length;
  if(n<30)return [0,1];
  let seed=0x5f3759df;
  const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
  const values=[];
  for(let b=0;b<reps;b++){
    let wins=0,count=0;
    while(count<n){
      const start=Math.floor(rand()*n);
      for(let k=0;k<blockLength&&count<n;k++,count++)wins+=seq[(start+k)%n];
    }
    values.push(wins/n);
  }
  values.sort((a,b)=>a-b);
  return [values[Math.floor(reps*.025)],values[Math.min(reps-1,Math.ceil(reps*.975)-1)]];
}

function stats(trades, payout) {
  const wins=trades.filter(t=>t.r==='W').length,losses=trades.filter(t=>t.r==='L').length,ties=trades.length-wins-losses,n=wins+losses;
  const breakeven=1/(1+payout/100),profit=wins*(payout/100)-losses;
  return {entradas:trades.length,vitorias:wins,derrotas:losses,empates:ties,taxaAcerto:n?wins/n:0,
    intervalo95:wilson(wins,n),intervalo95Blocos:blockBootstrap(trades),pontoDeEquilibrio:breakeven,
    resultadoUnidades:profit,esperancaPorEntrada:n?profit/n:0};
}

function makeTrades(candles,P,start,end) {
  const o=candles.map(x=>x.o),h=candles.map(x=>x.h),l=candles.map(x=>x.l),c=candles.map(x=>x.c);
  const eF=ema(c,P.emaFast),eS=ema(c,P.emaSlow),R=rsi(c,14),A=adx(h,l,c,14),trades=[];
  for(let i=Math.max(60,start);i<Math.min(end,c.length-P.expiry);i++){
    if(eF[i]==null||eS[i]==null||R[i]==null||A[i]==null)continue;
    let dir=null;
    if(eF[i]>eS[i]&&A[i]>=P.adxMin&&R[i]<=P.rsiLow)dir='CALL';
    else if(eF[i]<eS[i]&&A[i]>=P.adxMin&&R[i]>=P.rsiHigh)dir='PUT';
    if(!dir)continue;
    // Sinal só existe depois do fechamento de i; entrada executável é a abertura de i+1.
    const entryIndex=i+1,exitIndex=i+P.expiry,entry=o[entryIndex],exit=c[exitIndex];
    let r='T';if(exit>entry)r=dir==='CALL'?'W':'L';else if(exit<entry)r=dir==='PUT'?'W':'L';
    trades.push({i,entryIndex,exitIndex,dir,r,entry,exit,signalTime:candles[i].t,entryTime:candles[entryIndex].t,expiryTime:candles[exitIndex].t});
  }
  return trades;
}

function run(candles,userParams={}) {
  if(!Array.isArray(candles)||candles.length<100)throw new Error('São necessários pelo menos 100 candles fechados');
  const P={...DEFAULTS,...userParams},cut=Math.floor(candles.length*.7);
  const candidates=(userParams.emaFast||userParams.emaSlow)?[P]:TRAINING_GRID.map(g=>({...P,...g}));
  let selected=P,bestTrain=-Infinity,trainingTrades=[];
  for(const candidate of candidates){
    const trades=makeTrades(candles,candidate,60,cut),s=stats(trades,candidate.payout);
    if(s.entradas>=20&&s.esperancaPorEntrada>bestTrain){bestTrain=s.esperancaPorEntrada;selected=candidate;trainingTrades=trades;}
  }
  if(!trainingTrades.length)trainingTrades=makeTrades(candles,selected,60,cut);
  const testTrades=makeTrades(candles,selected,cut,candles.length-selected.expiry),allTrades=makeTrades(candles,selected,60,candles.length-selected.expiry);
  const sTreino=stats(trainingTrades,selected.payout),sTeste=stats(testTrades,selected.payout),sTotal=stats(allTrades,selected.payout);
  let wc=0,lc=0;for(let i=cut;i<candles.length-selected.expiry;i++){const d=candles[i+selected.expiry].c-candles[i+1].o;if(d>0)wc++;else if(d<0)lc++}
  const sempreCall={taxaAcerto:(wc+lc)?wc/(wc+lc):0};
  let veredito;
  if(sTeste.vitorias+sTeste.derrotas<100)veredito='Poucas entradas no teste (menos de 100): resultado inconclusivo. Use mais candles.';
  else if(sTeste.intervalo95Blocos[0]>sTeste.pontoDeEquilibrio)veredito='Há indício de vantagem fora da amostra, inclusive na reamostragem em blocos; confirme em outros períodos e ativos.';
  else if(sTeste.taxaAcerto>sTeste.pontoDeEquilibrio)veredito='Acima do equilíbrio, mas sem intervalo em blocos acima do ponto de equilíbrio: vantagem não comprovada.';
  else veredito='Sem vantagem demonstrada: resultado no teste fora da amostra não supera o ponto de equilíbrio.';
  return {parametros:selected,candles:candles.length,treino:sTreino,teste:sTeste,total:sTotal,sempreCall,veredito,
    metodo:'70% treino com seleção de EMA entre 3 combinações; 30% teste cronológico intocado; entrada na abertura do candle seguinte; IC Wilson e bootstrap em blocos de 5 sinais',
    amostraOperacoes:testTrades.slice(0,20)};
}
module.exports={run,DEFAULTS,stats,makeTrades,blockBootstrap};
