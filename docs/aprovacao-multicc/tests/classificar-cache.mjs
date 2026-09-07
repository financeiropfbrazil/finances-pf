// Análise offline: não importa o coletor, não lê credenciais e não faz chamadas HTTP.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import ts from 'typescript';
globalThis.fetch=()=>{throw new Error('HTTP proibido nesta classificação offline');};
const root=new URL('../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
const hash=s=>createHash('sha256').update(s).digest('hex');
const source=read('../../supabase/functions/_shared/requisicao-unidades.ts');
assert.equal(source,read('gateway/req-unidades.ts'),'Gateway e shared devem usar o mesmo validador');
const mod={};new Function('exports',ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(mod);
const recent=JSON.parse(read('tests/cobertura-unidades.json')).produtos_unidades;
const codes=[...new Set(recent.map(x=>x.codigo_produto))].sort();assert.equal(codes.length,171);
const produtos=[];
for(const codigo of codes) {
 const text=read(`produto-load/respostas/${codigo}.json`), response=JSON.parse(text);
 assert.equal(response.status,200);assert.equal(response.codigo,codigo);
 const raw=mod.objetoAlvo(response.data,'ProdUnidMedChildList');assert.equal(raw.Codigo,codigo);
 let cadastro,erroProduto;try{cadastro=mod.unidadesProduto(response.data,codigo);}catch(e){erroProduto=e.message;}
 const uso=recent.filter(x=>x.codigo_produto===codigo);
 const unidades=raw.ProdUnidMedChildList.map(u=>{
   let motivo=erroProduto;
   if(!motivo)try {
     const selecionada=cadastro.find(x=>x.posicao===Number(u.Posicao));
     const principal=mod.converterSolicitada(1,selecionada);
     mod.validarItemCadastro({codigo_prod_unid_med:selecionada.codigo,posicao_prod_unid_med:selecionada.posicao,quantidade_solicitada:1,quantidade:principal},cadastro);
   }catch(e){motivo=e.message;}
   return {codigo:u.CodigoUnidMedida,posicao:u.Posicao,peso:u.Peso,tipo:u.PesoFatorDivisor,compras:u.UnidadeMedidaCompras==='Sim',usada_por_codigo:uso.some(x=>x.codigo_prod_unid_med===u.CodigoUnidMedida),classificacao:motivo?'bloqueada':'suportada',...(motivo?{motivo}:{})};
 }).sort((a,b)=>a.posicao-b.posicao);
 const historico=uso.map(x=>{
   const matches=unidades.filter(u=>u.codigo===x.codigo_prod_unid_med);
   return {codigo:x.codigo_prod_unid_med,itens:x.itens,requisicoes:x.requisicoes,posicao_historica:null,posicoes_no_cadastro:matches.map(u=>u.posicao),situacao:!matches.length?'ausente':matches.length>1?'ambigua':matches[0].classificacao};
 });
 produtos.push({codigo,resposta_sha256:hash(text),consultado_em:response.consultado_em,classificacao:unidades.every(u=>u.classificacao==='suportada')?'todas_suportadas':unidades.some(u=>u.classificacao==='suportada')?'parcial':'todas_bloqueadas',unidades,historico});
}
const unidades=produtos.flatMap(p=>p.unidades),historico=produtos.flatMap(p=>p.historico);
const summary={produtos:produtos.length,produtos_todas_suportadas:produtos.filter(p=>p.classificacao==='todas_suportadas').length,produtos_parciais:produtos.filter(p=>p.classificacao==='parcial').length,produtos_todas_bloqueadas:produtos.filter(p=>p.classificacao==='todas_bloqueadas').length,unidades:unidades.length,suportadas:unidades.filter(u=>u.classificacao==='suportada').length,bloqueadas:unidades.filter(u=>u.classificacao==='bloqueada').length,compras:unidades.filter(u=>u.compras).length,compras_bloqueadas:unidades.filter(u=>u.compras&&u.classificacao==='bloqueada').length,produtos_sem_marca_compras:produtos.filter(p=>!p.unidades.some(u=>u.compras)).length,produtos_multiplas_marcas_compras:produtos.filter(p=>p.unidades.filter(u=>u.compras).length>1).length,pares_historicos:historico.length,itens_historicos:historico.reduce((s,x)=>s+x.itens,0),pares_bloqueados:historico.filter(x=>x.situacao==='bloqueada').length,pares_ambiguos:historico.filter(x=>x.situacao==='ambigua').length,pares_ausentes:historico.filter(x=>x.situacao==='ausente').length};
const original=JSON.parse(read('produto-load/classificacao.json'));
assert.equal(summary.suportadas,original.unidades_suportadas);
assert.equal(summary.bloqueadas,original.unidades_bloqueadas);
const report={gerado_em:new Date().toISOString(),modo:'offline; zero HTTP',validador_sha256:hash(source),ensaio:'Solicitada=1 por unidade, usando unidadesProduto, converterSolicitada e validarItemCadastro. Não reconstrói quantidades/posições históricas.',resumo:summary,produtos};
writeFileSync(new URL('produto-load/analise-offline.json',root),JSON.stringify(report,null,2)+'\n');
const lines=['produto;unidade;posicao;peso;tipo;compras;usada_por_codigo;classificacao;motivo'];
for(const p of produtos)for(const u of p.unidades)lines.push([p.codigo,u.codigo,u.posicao,u.peso,u.tipo,u.compras,u.usada_por_codigo,u.classificacao,u.motivo||''].map(x=>'"'+String(x).replaceAll('"','""')+'"').join(';'));
writeFileSync(new URL('produto-load/unidades.csv',root),'\uFEFF'+lines.join('\n')+'\n');
console.log(JSON.stringify({resumo:summary,bloqueios:produtos.filter(p=>p.classificacao!=='todas_suportadas')},null,2));
