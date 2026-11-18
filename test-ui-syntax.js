const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('public/index.html','utf8');
const match=html.match(/<script>([\\s\\S]*?)<\\/script>/i);
assert.ok(match,'script do painel encontrado');
new Function(match[1]);
console.log('Painel OK: JavaScript embutido compila.');
