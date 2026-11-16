const { ema, rsi, adx } = require('./indicators');

const DEFAULTS = { emaFast: 20, emaSlow: 50, adxMin: 20, rsiLow: 40, rsiHigh: 60, expiry: 1, payout: 85 };

// Intervalo de confiança de Wilson (95%) para a taxa de acerto
function wilson(w, n) {
  if (n === 0) return [0, 0];
  const z = 1.96, p = w / n, d = 1 + z * z / n;
  const c = p + z * z / (2 * n);
  const m = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
  return [(c - m) / d, (c + m) / d];
}

function stats(trades, payout) {
  const wins = trades.filter(t => t.r === 'W').length;
  const losses = trades.filter(t => t.r === 'L').length;
  const ties = trades.length - wins - losses;
  const n = wins + losses;
  const breakeven = 1 / (1 + payout / 100);
  const [lo, hi] = wilson(wins, n);
  const profit = wins * (payout / 100) - losses; // em "unidades de entrada"
  return {
    entradas: trades.length, vitorias: wins, derrotas: losses, empates: ties,
    taxaAcerto: n ? wins / n : 0,
    intervalo95: [lo, hi],
    pontoDeEquilibrio: breakeven,
    resultadoUnidades: profit,
    esperancaPorEntrada: n ? profit / n : 0
  };
}

function run(candles, userParams = {}) {
  const P = { ...DEFAULTS, ...userParams };
  const o = candles.map(x => x.o), h = candles.map(x => x.h), l = candles.map(x => x.l), c = candles.map(x => x.c);
  const eF = ema(c, P.emaFast), eS = ema(c, P.emaSlow), R = rsi(c, 14), A = adx(h, l, c, 14);
  const trades = [];
  for (let i = 60; i < c.length - P.expiry; i++) {
    if (eF[i] == null || eS[i] == null || R[i] == null || A[i] == null) continue;
    let dir = null;
    if (eF[i] > eS[i] && A[i] >= P.adxMin && R[i] <= P.rsiLow) dir = 'CALL';
    else if (eF[i] < eS[i] && A[i] >= P.adxMin && R[i] >= P.rsiHigh) dir = 'PUT';
    if (!dir) continue;
    const entry = c[i], exit = c[i + P.expiry];
    let r = 'T';
    if (exit > entry) r = dir === 'CALL' ? 'W' : 'L';
    else if (exit < entry) r = dir === 'PUT' ? 'W' : 'L';
    trades.push({ i, dir, r });
  }
  // Separa treino (70%) e teste (30%): o teste é o que importa
  const cut = Math.floor(c.length * 0.7);
  const treino = trades.filter(t => t.i < cut), teste = trades.filter(t => t.i >= cut);
  const sTreino = stats(treino, P.payout), sTeste = stats(teste, P.payout), sTotal = stats(trades, P.payout);

  // Comparação: "sempre CALL" nos mesmos candles (referência de sorte)
  let wc = 0, lc = 0;
  for (let i = 60; i < c.length - P.expiry; i++) { const d = c[i + P.expiry] - c[i]; if (d > 0) wc++; else if (d < 0) lc++; }
  const sempreCall = { taxaAcerto: (wc + lc) ? wc / (wc + lc) : 0 };

  let veredito;
  if (sTeste.vitorias + sTeste.derrotas < 100)
    veredito = 'Poucas entradas no teste (menos de 100): o resultado não é confiável. Use mais candles.';
  else if (sTeste.intervalo95[0] > sTeste.pontoDeEquilibrio)
    veredito = 'Há indício de vantagem no teste, mas confirme em outros períodos e ativos antes de qualquer dinheiro real.';
  else if (sTeste.taxaAcerto > sTeste.pontoDeEquilibrio)
    veredito = 'Acima do equilíbrio, mas dentro da margem de erro: ainda pode ser sorte. Sem prova de vantagem.';
  else
    veredito = 'Sem vantagem: a taxa de acerto no teste está abaixo do ponto de equilíbrio. Operar isso tende a perder dinheiro.';

  return { parametros: P, candles: c.length, treino: sTreino, teste: sTeste, total: sTotal, sempreCall, veredito };
}

module.exports = { run, DEFAULTS };
