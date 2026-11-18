const assert = require('node:assert/strict');
const { ema, rsi, adx, macd, bollinger, atr, dmi } = require('./indicators');
const close=[],high=[],low=[];
let price=100;
for(let i=0;i<260;i++){
  const drift=i<130?0.08:-0.025;
  const wave=Math.sin(i/4)*0.12;
  const next=price+drift+wave;
  close.push(next);high.push(Math.max(price,next)+0.15);low.push(Math.min(price,next)-0.15);price=next;
}
const e=ema(close,20),r=rsi(close,14),a=adx(high,low,close,14),m=macd(close),b=bollinger(close,20,2),t=atr(high,low,close,14),d=dmi(high,low,close,14);
const last=close.length-1;
for(const [name,value] of Object.entries({EMA:e[last],RSI:r[last],ADX:a[last],MACD:m.line[last],MACD_SIGNAL:m.signal[last],MACD_HIST:m.histogram[last],BB_UPPER:b.upper[last],BB_MIDDLE:b.mid[last],BB_LOWER:b.lower[last],ATR:t[last],DI_PLUS:d.plus[last],DI_MINUS:d.minus[last]})){
  assert.equal(Number.isFinite(value),true,name+' deve ser finito');
}
assert.ok(b.upper[last]>b.mid[last]&&b.mid[last]>b.lower[last],'Bandas Bollinger devem estar ordenadas');
assert.ok(t[last]>0,'ATR deve ser positivo');
assert.ok(r[last]>=0&&r[last]<=100,'RSI deve ficar entre 0 e 100');
console.log('Indicadores OK: EMA, RSI, ADX, MACD, Bollinger, ATR, DI+ e DI-.');
