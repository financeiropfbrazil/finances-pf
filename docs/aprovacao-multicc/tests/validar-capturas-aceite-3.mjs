// Valida as respostas já obtidas pelo formulário real. Nenhuma chamada de rede.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
const source = readFileSync('supabase/functions/_shared/requisicao-unidades.ts', 'utf8');
const exports = {};
new Function('exports', ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(exports);
const folder = 'docs/aprovacao-multicc/tests/formulario-aceite-3';
const results = [];
for (const [codigo, posicao, expected] of [
  ['001.001.00051', 1, [10, 20]], ['001.013.00382', 2, [1, 2]],
]) {
  const units = exports.unidadesProduto(JSON.parse(readFileSync(`${folder}/${codigo}.json`, 'utf8')), codigo);
  const unidade = units.find(u => u.posicao === posicao);
  assert.equal(unidade.codigo, 'UNID');
  const principal = [10, 20].map(q => exports.converterSolicitada(q, unidade));
  assert.deepEqual(principal, expected);
  results.push({ codigo, unidade, solicitadas: [10, 20], principais: principal });
}
const units = exports.unidadesProduto(JSON.parse(readFileSync(`${folder}/001.017.092.json`, 'utf8')), '001.017.092');
const compras = units.filter(u => u.compras);
assert.equal(compras.length, 1);
assert.equal(compras[0].codigo, 'M3');
assert.equal(compras[0].posicao, 3);
assert.throws(() => exports.converterSolicitada(1, compras[0]), /Divisor/);
results.push({ codigo: '001.017.092', compras: compras[0], bloqueada: true, motivo: 'Divisor' });
writeFileSync(`${folder}/conversoes.json`, JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
