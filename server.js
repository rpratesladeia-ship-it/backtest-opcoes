const http = require('http');
const fs = require('fs');
const path = require('path');
const { run } = require('./backtest');

const PORT = process.env.PORT || 3000;
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];

async function klines(symbol, interval, total) {
  let all = [], endTime = null;
  while (all.length < total) {
    const limit = Math.min(1000, total - all.length);
    let data = null, lastErr;
    for (const host of HOSTS) {
      try {
        const url = `${host}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}` + (endTime ? `&endTime=${endTime}` : '');
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        data = await r.json();
        break;
      } catch (e) { lastErr = e; }
    }
    if (!data) throw new Error('Não consegui baixar candles: ' + lastErr.message);
    if (!data.length) break;
    all = data.concat(all);
    endTime = data[0][0] - 1;
    if (data.length < limit) break;
  }
  return all.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] }));
}

const num = (v, d) => (v !== null && v !== '' && !isNaN(+v) ? +v : d);

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/backtest') {
    try {
      const q = u.searchParams;
      const symbol = (q.get('symbol') || 'BTCUSDT').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const interval = ['1m', '5m'].includes(q.get('interval')) ? q.get('interval') : '1m';
      const total = Math.min(num(q.get('candles'), 5000), 10000);
      const candles = await klines(symbol, interval, total);
      const params = {
        expiry: num(q.get('expiry'), 1), payout: num(q.get('payout'), 85),
        adxMin: num(q.get('adxMin'), 20), rsiLow: num(q.get('rsiLow'), 40), rsiHigh: num(q.get('rsiHigh'), 60)
      };
      const result = run(candles, params);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ symbol, interval, ...result }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: e.message }));
    }
    return;
  }
  const file = path.join(__dirname, 'public', 'index.html');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => console.log('Backtest rodando na porta ' + PORT));
