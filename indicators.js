// Indicadores técnicos (Wilder) — sem dependências
function ema(c, p) {
  const k = 2 / (p + 1), out = new Array(c.length).fill(null);
  if (c.length < p) return out;
  let prev = c.slice(0, p).reduce((a, b) => a + b, 0) / p;
  out[p - 1] = prev;
  for (let i = p; i < c.length; i++) { prev = c[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

function rsi(c, p = 14) {
  const out = new Array(c.length).fill(null);
  if (c.length <= p) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; if (d >= 0) g += d; else l -= d; }
  g /= p; l /= p;
  out[p] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = p + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g = (g * (p - 1) + (d > 0 ? d : 0)) / p;
    l = (l * (p - 1) + (d < 0 ? -d : 0)) / p;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

function adx(h, l, c, p = 14) {
  const n = c.length, out = new Array(n).fill(null), dx = new Array(n).fill(null);
  if (n < 2 * p + 1) return out;
  let str = 0, sp = 0, sm = 0;
  for (let i = 1; i < n; i++) {
    const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
    const pdm = up > dn && up > 0 ? up : 0;
    const mdm = dn > up && dn > 0 ? dn : 0;
    const tr = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    if (i <= p) { str += tr; sp += pdm; sm += mdm; }
    else { str = str - str / p + tr; sp = sp - sp / p + pdm; sm = sm - sm / p + mdm; }
    if (i >= p) {
      const pdi = 100 * sp / str, mdi = 100 * sm / str, s = pdi + mdi;
      dx[i] = s === 0 ? 0 : 100 * Math.abs(pdi - mdi) / s;
    }
  }
  let sum = 0, cnt = 0;
  for (let i = p; i < n; i++) {
    if (dx[i] == null) continue;
    if (cnt < p) { sum += dx[i]; cnt++; if (cnt === p) out[i] = sum / p; }
    else out[i] = (out[i - 1] * (p - 1) + dx[i]) / p;
  }
  return out;
}

module.exports = { ema, rsi, adx };
