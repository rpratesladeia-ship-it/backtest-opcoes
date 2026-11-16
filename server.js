const http = require('http');
const fs = require('fs');
const path = require('path');
const { run } = require('./backtest');
const PORT = process.env.PORT || 3000;
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function binanceKlines(symbol, interval, total) {
  let all = [], endTime = null;
  while (all.length < total) {
    const limit = Math.min(1000, total - all.length);
    let data = null, lastErr;
    for (const host of HOSTS) {
      try {
        const url = `${host}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}` + (endTime ? `&endTime=${endTime}` : '');
        const r = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'backtest-opcoes/1.1' } });
        if (r.status === 418 || r.status === 429) throw new Error(`Binance HTTP ${r.status}: bloqueio temporário do IP`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        data = await r.json();
        break;
      } catch (e) { lastErr = e; }
    }
    if (!data) throw new Error(lastErr ? lastErr.message : 'Falha na Binance');
    if (!Array.isArray(data) || !data.length) break;
    all = data.concat(all);
    endTime = data[0][0] - 1;
    if (data.length < limit) break;
    await sleep(250);
  }
  return { candles: all.map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] })), source: 'Binance' };
}

async function okxKlines(symbol, interval, total) {
  const instId = symbol.replace('USDT', '-USDT');
  const bar = interval === '5m' ? '5m' : '1m';
  let all = [], after = null;
  while (all.length < total) {
    const limit = Math.min(300, total - all.length);
    const url = new URL('https://www.okx.com/api/v5/market/candles');
    url.searchParams.set('instId', instId);
    url.searchParams.set('bar', bar);
    url.searchParams.set('limit', String(limit));
    if (after) url.searchParams.set('after', String(after));
    const r = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'backtest-opcoes/1.1' } });
    if (!r.ok) throw new Error(`OKX HTTP ${r.status}`);
    const payload = await r.json();
    if (payload.code !== '0' || !Array.isArray(payload.data)) throw new Error(payload.msg || 'Resposta inválida da OKX');
    const page = payload.data;
    if (!page.length) break;
    all = all.concat(page);
    const oldest = Math.min(...page.map(k => +k[0]));
    after = oldest - 1;
    if (page.length < limit) break;
    await sleep(120);
  }
  const candles = all
    .filter(k => k[8] === '1')
    .map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] }))
    .sort((a, b) => a.t - b.t);
  const unique = candles.filter((k, i) => i === 0 || k.t !== candles[i - 1].t).slice(-total);
  if (unique.length < Math.min(total, 100)) throw new Error(`OKX retornou apenas ${unique.length} candles fechados`);
  return { candles: unique, source: 'OKX' };
}

async function klines(symbol, interval, total) {
  try {
    return await binanceKlines(symbol, interval, total);
  } catch (binanceError) {
    try {
      return await okxKlines(symbol, interval, total);
    } catch (okxError) {
      throw new Error(`Binance: ${binanceError.message}; OKX: ${okxError.message}`);
    }
  }
}

const num = (v, d) => (v !== null && v !== '' && Number.isFinite(+v) ? +v : d);
function params(q) {
  return { expiry: Math.max(1, Math.min(10, num(q.get('expiry'), 1))), payout: Math.max(1, Math.min(100, num(q.get('payout'), 85))),
    adxMin: num(q.get('adxMin'), 20), rsiLow: num(q.get('rsiLow'), 40), rsiHigh: num(q.get('rsiHigh'), 60) };
}
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/health') return json(res, 200, { ok: true, symbols: SYMBOLS, providers: ['Binance', 'OKX'] });
  if (u.pathname === '/api/backtest' || u.pathname === '/api/scan') {
    const q = u.searchParams, interval = ['1m', '5m'].includes(q.get('interval')) ? q.get('interval') : '1m';
    const total = Math.max(500, Math.min(num(q.get('candles'), u.pathname === '/api/scan' ? 1000 : 5000), 10000));
    const P = params(q);
    try {
      if (u.pathname === '/api/backtest') {
        const symbol = (q.get('symbol') || 'BTCUSDT').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const result = await klines(symbol, interval, total);
        return json(res, 200, { symbol, interval, fonteDados: result.source, ...run(result.candles, P) });
      }
      const results = [];
      for (const symbol of SYMBOLS) {
        try {
          const result = await klines(symbol, interval, total);
          results.push({ symbol, interval, fonteDados: result.source, ...run(result.candles, P) });
          await sleep(350);
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
          : 'Nenhum ativo pôde ser analisado. Os provedores de candles não responderam.', resultsCount: valid.length });
    } catch (e) { return json(res, 502, { erro: e.message }); }
  }
  const file = path.join(__dirname, 'public', 'index.html');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  fs.createReadStream(file).pipe(res);
});
server.listen(PORT, () => console.log('Backtest Opções scanner rodando na porta ' + PORT));