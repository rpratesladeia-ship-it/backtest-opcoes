// Teste com preço aleatório (sem vantagem possível): o resultado deve ficar perto de 50%
const { run } = require('./backtest');
let s = 12345; const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
let p = 100; const candles = [];
for (let i = 0; i < 20000; i++) {
  const o = p, c = o * (1 + (rnd() - 0.5) * 0.002);
  candles.push({ o, h: Math.max(o, c) * (1 + rnd() * 0.0005), l: Math.min(o, c) * (1 - rnd() * 0.0005), c });
  p = c;
}
const r = run(candles, { payout: 85 });
console.log(JSON.stringify({ entradasTeste: r.teste.entradas, acertoTeste: r.teste.taxaAcerto.toFixed(3), acertoTotal: r.total.taxaAcerto.toFixed(3), equilibrio: r.total.pontoDeEquilibrio.toFixed(3), resultadoUnid: r.total.resultadoUnidades.toFixed(1), veredito: r.veredito }, null, 1));
