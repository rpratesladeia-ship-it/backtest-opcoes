const assert=require('node:assert/strict');
const {run,makeTrades,stats}=require('./backtest');
let seed=12345;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
let p=100;const candles=[];
for(let i=0;i<6000;i++){const o=p,c=o*(1+(rnd()-.5)*.003),h=Math.max(o,c)*(1+rnd()*.0005),l=Math.min(o,c)*(1-rnd()*.0005);candles.push({t:i*60000,o,h,l,c});p=c}
const result=run(candles,{payout:85});
assert.equal(result.candles,6000);
assert.ok(result.treino&&result.teste);
assert.ok(Array.isArray(result.teste.intervalo95Blocos));
assert.ok(result.metodo.includes('abertura do candle seguinte'));
const trades=makeTrades(candles,{emaFast:20,emaSlow:50,adxMin:0,rsiLow:100,rsiHigh:0,expiry:1,payout:85},60,500);
for(const trade of trades){assert.equal(trade.entry,candles[trade.i+1].o);assert.equal(trade.exit,candles[trade.i+1].c);assert.equal(trade.entryTime,candles[trade.i+1].t)}
const s=stats([{r:'W'},{r:'L'},{r:'T'}],85);assert.equal(s.entradas,3);assert.equal(s.empates,1);
console.log('Auditoria backtest OK:',JSON.stringify({treino:result.treino.entradas,teste:result.teste.entradas,veredito:result.veredito}));
