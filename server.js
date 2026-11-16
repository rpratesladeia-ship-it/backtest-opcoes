const http = require('http');
const fs = require('fs');
const path = require('path');
const { run } = require('./backtest');
const PORT = process.env.PORT || 3000;
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function klines(symbol, interval, total) {
  let all = [], endTime = null;
  while (all.length < total) {
    const limit = Math.min(1000, total - all.length);
    let data = null, lastErr;
    for (const host of HOSTS) {
      try {
        const url = `${host}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}` + (endTime ? `&endTime=${endTime}` : '');
        const r = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'backtest-opcoes/1.0' } });
        if (r.status === 418 || r.status === 429) throw new Error(`Binance HTTP ${r.status}: limite ou bloqueio temporário do IP do servidor`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        data = await r.json(); break;
      } catch (e) { lastErr = e; }
    }
    if (!data) throw new Error('Não consegui baixar candles: ' + lastErr.message);
    if (!data.length) break;
    all = data.concat(all); endTime = data[0][0] - 1;
    if (data.length < limit) break;
    await sleep(250);
  }
  return all.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] }));
}
const num = (v, d) => (v !== null && v !== '' && Number.isFinite(+v) ? +v : d);
function params(q) {
  return { expiry: Math.max(1, Math.min(10, num(q.get('expiry'), 1))), payout: Math.max(1, Math.min(100, num(q.get('payout'), 85))),
    adxMin: num(q.get('adxMin'), 20), rsiLow: num(q.get('rsiLow'), 40), rsiHigh: num(q.get('rsiHigh'), 60) };
}
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/health') return json(res, 200, { ok: true, symbols: SYMBOLS });
  if (u.pathname === '/api/backtest' || u.pathname === '/api/scan') {
    const q = u.searchParams, interval = ['1m', '5m'].includes(q.get('interval')) ? q.get('interval') : '1m';
    const total = Math.max(500, Math.min(num(q.get('candles'), u.pathname === '/api/scan' ? 1000 : 5000), 10000));
    const P = params(q);
    try {
      if (u.pathname === '/api/backtest') {
        const symbol = (q.get('symbol') || 'BTCUSDT').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const candles = await klines(symbol, interval, total);
        return json(res, 200, { symbol, interval, ...run(candles, P) });
      }
      const results = [];
      for (const symbol of SYMBOLS) {
        try {
          const candles = await klines(symbol, interval, total);
          results.push({ symbol, interval, ...run(candles, P) });
          await sleep(500);
        } catch (e) { results.push({ symbol, erro: e.message }); }
      }
      const valid = results.filter(x => !x.erro && x.teste);
      valid.sort((a, b) => {
        const aProof = a.teste.entradas >= 100 && a.teste.intervalo95[0] > a.teste.pontoDeEquilibrio;
        const bProof = b.teste.entradas >= 100 && b.teste.intervalo95[0] > b.teste.pontoDeEquilibrio;
        if (aProof !== bProof) return aProof ? -1 : 1;
        return b.teste.esperancaPorEntrada - a.teste.esperancaPorEntrada;
      });
      const best = valid[0] || null;
      const hasEvidence = !!best && best.teste.entradas >= 100 && best.teste.intervalo95[0] > best.teste.pontoDeEquilibrio;
      return json(res, 200, { interval, symbols: SYMBOLS, results, best: best ? best.symbol : null, hasEvidence,
        message: valid.length ? (hasEvidence
          ? 'Melhor candidato com indício estatístico. Ainda exige validação em outros períodos.'
          : 'Melhor resultado relativo entre os ativos testados, mas sem vantagem estatística comprovada.')
          : 'Nenhum ativo pôde ser analisado. Verifique o acesso aos dados da Binance.', resultsCount: valid.length });
    } catch (e) { return json(res, 502, { erro: e.message }); }
  }
  const file = path.join(__dirname, 'public', 'index.html');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  fs.createReadStream(file).pipe(res);
});
server.listen(PORT, () => console.log('Backtest Opções scanner rodando na porta ' + PORT));