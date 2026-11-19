const fs = require('fs');
const path = require('path');
const RETENTION_DAYS = 90;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const DATA_DIR = process.env.JOURNAL_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'journal.json');
let pool = null;
let ready = false;
let local = [];

function cutoff() { return Date.now() - RETENTION_MS; }
function prune(items) { return items.filter(x => Number(x.createdAt) >= cutoff()); }
async function init() {
  if (ready) return;
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: false },
      max: 3
    });
    await pool.query(`CREATE TABLE IF NOT EXISTS alpha_trade_journal (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      payload JSONB NOT NULL
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS alpha_trade_journal_created_idx ON alpha_trade_journal(created_at)');
    await pool.query('DELETE FROM alpha_trade_journal WHERE created_at < $1', [cutoff()]);
  } else {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    try {
      const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      local = Array.isArray(parsed) ? prune(parsed) : [];
    } catch { local = []; }
    await flush();
  }
  ready = true;
}
async function flush() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(prune(local)));
  fs.renameSync(tmp, FILE);
}
async function save(entry) {
  await init();
  const item = { ...entry, createdAt: Number(entry.createdAt) || Date.now() };
  if (!item.id || !item.kind) throw new Error('Registro do diário sem id ou tipo.');
  if (pool) {
    await pool.query(
      'INSERT INTO alpha_trade_journal(id,kind,created_at,payload) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET kind=EXCLUDED.kind, created_at=EXCLUDED.created_at, payload=EXCLUDED.payload',
      [item.id, item.kind, item.createdAt, item]
    );
    await pool.query('DELETE FROM alpha_trade_journal WHERE created_at < $1', [cutoff()]);
  } else {
    const i = local.findIndex(x => x.id === item.id);
    if (i >= 0) local[i] = item; else local.push(item);
    local = prune(local);
    await flush();
  }
  return item;
}
async function list({ limit = 500, kind = null } = {}) {
  await init();
  const n = Math.max(1, Math.min(2000, Number(limit) || 500));
  if (pool) {
    const args = kind ? [cutoff(), kind, n] : [cutoff(), n];
    const sql = kind
      ? 'SELECT payload FROM alpha_trade_journal WHERE created_at >= $1 AND kind = $2 ORDER BY created_at DESC LIMIT $3'
      : 'SELECT payload FROM alpha_trade_journal WHERE created_at >= $1 ORDER BY created_at DESC LIMIT $2';
    const r = await pool.query(sql, args);
    return r.rows.map(x => x.payload);
  }
  local = prune(local);
  await flush();
  return local.filter(x => !kind || x.kind === kind).sort((a,b) => b.createdAt-a.createdAt).slice(0,n);
}
async function stats() {
  await init();
  let totalRecords=0,analyses=0,opportunities=0,wins=0,losses=0,ties=0,byAsset={};
  if(pool){
    const totals=await pool.query(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE kind='analysis')::int AS analyses,
      COUNT(*) FILTER (WHERE kind='opportunity')::int AS opportunities,
      COUNT(*) FILTER (WHERE kind='operation' AND payload->>'result' IN ('WIN','LOSS','TIE'))::int AS operations,
      COUNT(*) FILTER (WHERE kind='operation' AND payload->>'result'='WIN')::int AS wins,
      COUNT(*) FILTER (WHERE kind='operation' AND payload->>'result'='LOSS')::int AS losses,
      COUNT(*) FILTER (WHERE kind='operation' AND payload->>'result'='TIE')::int AS ties
      FROM alpha_trade_journal WHERE created_at >= $1`,[cutoff()]);
    const t=totals.rows[0];totalRecords=t.total;analyses=t.analyses;opportunities=t.opportunities;wins=t.wins;losses=t.losses;ties=t.ties;
    const grouped=await pool.query(`SELECT payload->>'symbol' AS symbol,payload->>'result' AS result,COUNT(*)::int AS n
      FROM alpha_trade_journal WHERE created_at >= $1 AND kind='operation' AND payload->>'result' IN ('WIN','LOSS','TIE')
      GROUP BY payload->>'symbol',payload->>'result'`,[cutoff()]);
    for(const row of grouped.rows){const key=row.symbol||'Desconhecido';byAsset[key] ||= {wins:0,losses:0,ties:0};if(row.result==='WIN')byAsset[key].wins=row.n;else if(row.result==='LOSS')byAsset[key].losses=row.n;else byAsset[key].ties=row.n;}
  }else{
    local=prune(local);await flush();totalRecords=local.length;
    analyses=local.filter(x=>x.kind==='analysis').length;opportunities=local.filter(x=>x.kind==='opportunity').length;
    const outcomes=local.filter(x=>x.kind==='operation'&&['WIN','LOSS','TIE'].includes(x.result));
    wins=outcomes.filter(x=>x.result==='WIN').length;losses=outcomes.filter(x=>x.result==='LOSS').length;ties=outcomes.filter(x=>x.result==='TIE').length;
    for(const x of outcomes){const key=x.symbol||'Desconhecido';byAsset[key] ||= {wins:0,losses:0,ties:0};if(x.result==='WIN')byAsset[key].wins++;else if(x.result==='LOSS')byAsset[key].losses++;else byAsset[key].ties++;}
  }
  for(const v of Object.values(byAsset)){const d=v.wins+v.losses;v.accuracy=d?+(v.wins/d*100).toFixed(2):null;}
  const decided=wins+losses;
  return {retentionDays:RETENTION_DAYS,storage:pool?'postgresql':'local-temporario',totalRecords,analyses,opportunities,
    operations:wins+losses+ties,wins,losses,ties,accuracy:decided?+(wins/decided*100).toFixed(2):null,byAsset};
}
module.exports = { init, save, list, stats, retentionDays: RETENTION_DAYS };
