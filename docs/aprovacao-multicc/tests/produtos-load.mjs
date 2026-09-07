// Somente GET no gateway existente; nenhuma gravação no Alvo/Supabase.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
const base=new URL('../',import.meta.url), out=new URL('produto-load/',base);
mkdirSync(out,{recursive:true});mkdirSync(new URL('respostas/',out),{recursive:true});
const recent=JSON.parse(readFileSync(new URL('tests/cobertura-unidades.json',base),'utf8')).produtos_unidades;
const codes=[...new Set(recent.map(x=>x.codigo_produto))].sort();
const source=readFileSync('supabase/functions/_shared/requisicao-unidades.ts','utf8');
const exports={};new Function('exports',ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(exports);
const {objetoAlvo,unidadesProduto,converterSolicitada,validarItemCadastro}=exports;
const headers=process.env.MULTICC_GATEWAY_JWT?{Authorization:`Bearer ${process.env.MULTICC_GATEWAY_JWT}`}:
 process.env.MULTICC_GATEWAY_SYSTEM_SECRET?{'X-System-Secret':process.env.MULTICC_GATEWAY_SYSTEM_SECRET}:{};
const manifest=[],failures=[];let stopped=null,calls=0;
console.log(`Coleta iniciada: ${codes.length} produtos; concorrência 1; intervalo 750ms; timeout 45s por GET. Respostas existentes serão reutilizadas.`);
for(const codigo of codes) {
 const progress=`[${manifest.length+1}/${codes.length}] ${codigo}`;
 const file=new URL(`respostas/${codigo}.json`,out);let response;
 if(existsSync(file)) {response=JSON.parse(readFileSync(file,'utf8'));console.log(`${progress}: cache reutilizado, sem consulta.`);}
 else if(!stopped) {
   console.log(`${progress}: consultando Produto/Load...`);
   const started=Date.now();
   const heartbeat=setInterval(()=>console.log(`${progress}: aguardando resposta (${Math.floor((Date.now()-started)/1000)}s; limite 45s).`),10000);
   calls++;try {
     const r=await fetch(`https://erp-proxy.onrender.com/produto/load?codigo=${encodeURIComponent(codigo)}`,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(45000)});
     const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=null;}
     response={codigo,consultado_em:new Date().toISOString(),status:r.status,data};
     if(r.ok) {writeFileSync(file,JSON.stringify(response,null,2)+'\n');console.log(`${progress}: HTTP ${r.status}, resposta salva (${((Date.now()-started)/1000).toFixed(1)}s).`);}
     else {failures.push({...response,erro:'HTTP não bem-sucedido'});console.log(`${progress}: HTTP ${r.status}, falha registrada separadamente.`);if([401,403,429].includes(r.status))stopped=`HTTP ${r.status}: interrompido para não repetir recusas/limite`;}
   }catch(e){failures.push({codigo,erro:e.name});stopped=e.name==='TimeoutError'?'Timeout de 45s; coleta interrompida, respostas já salvas preservadas':`Falha de transporte ${e.name}; retomar após verificar acesso`;}
   finally {clearInterval(heartbeat);}
   if(stopped)console.log(`${progress}: ${stopped}.`);
   await new Promise(r=>setTimeout(r,750));
 }
 const used=recent.filter(x=>x.codigo_produto===codigo);
 const entry={codigo,usadas_no_espelho:used.map(x=>({codigo:x.codigo_prod_unid_med,itens:x.itens,posicao:'ausente no espelho; não inferida'})),unidades:[]};
 if(!response || response.status!==200 || !response.data) {entry.consulta='inconclusiva';entry.motivo=stopped||'Resposta ausente/inválida';manifest.push(entry);continue;}
 try {
   const raw=objetoAlvo(response.data,'ProdUnidMedChildList');
   if(raw.Codigo!==codigo)throw new Error('Produto divergente');
   let parsed,productError;try{parsed=unidadesProduto(response.data,codigo);}catch(e){productError=e.message;}
   entry.consulta='concluida';entry.consultado_em=response.consultado_em;
   for(const u of raw.ProdUnidMedChildList) {
     const unit={codigo:u.CodigoUnidMedida,posicao:u.Posicao,peso:u.Peso,tipo:u.PesoFatorDivisor,compras:u.UnidadeMedidaCompras==='Sim',usada_por_codigo:used.some(x=>x.codigo_prod_unid_med===u.CodigoUnidMedida)};
     try {
       if(productError)throw new Error(productError);
       const selected=parsed.find(x=>x.posicao===Number(u.Posicao));
       const principal=converterSolicitada(1,selected);
       validarItemCadastro({codigo_prod_unid_med:selected.codigo,posicao_prod_unid_med:selected.posicao,quantidade_solicitada:1,quantidade:principal},parsed);
       unit.classificacao='suportada';unit.limite='Formato validado com quantidade 1; quantidade concreta ainda deve passar pela precisão de 9 casas';
     }catch(e){unit.classificacao='bloqueada';unit.motivo=e.message;unit.categoria=/dependente|dimensional/.test(e.message)?'dimensoes':/base diferente/.test(e.message)?'base':/Divisor/.test(e.message)?'Divisor':'outro';}
     entry.unidades.push(unit);
   }
   if(!entry.unidades.length){entry.consulta='inconclusiva';entry.motivo='Load sem unidades';}
 }catch(e){entry.consulta='inconclusiva';entry.motivo=e.message;failures.push({codigo,erro:e.message});}
 manifest.push(entry);
}
const report={data:new Date().toISOString(),somente_get:true,concorrencia:1,intervalo_ms:750,chamadas_nesta_execucao:calls,validador_sha256:createHash('sha256').update(source).digest('hex'),produtos:codes.length,conclusivas:manifest.filter(x=>x.consulta==='concluida').length,inconclusivas:manifest.filter(x=>x.consulta==='inconclusiva').length,unidades_suportadas:manifest.flatMap(x=>x.unidades).filter(x=>x.classificacao==='suportada').length,unidades_bloqueadas:manifest.flatMap(x=>x.unidades).filter(x=>x.classificacao==='bloqueada').length,bloqueio:stopped,resultados:manifest};
writeFileSync(new URL('classificacao.json',out),JSON.stringify(report,null,2)+'\n');
writeFileSync(new URL(`falhas-${Date.now()}.json`,out),JSON.stringify(failures,null,2)+'\n');
console.log(JSON.stringify({...report,resultados:undefined}));
if(report.inconclusivas)process.exitCode=2;
