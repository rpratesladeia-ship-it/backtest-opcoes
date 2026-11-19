const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('public/index.html','utf8');
// The panel script may contain the literal string "</script>" in generated markup.
// Use the final real script boundary instead of a non-greedy regex.
const start=html.lastIndexOf('<script>');
const end=html.lastIndexOf('</script>');
assert.ok(start>=0 && end>start,'script do painel encontrado');
const script=html.slice(start+'<script>'.length,end);
new Function(script);
console.log('Painel OK: JavaScript embutido compila.');
