// Gera somente os artefatos desta entrega; não altera index, commits ou repositório externo.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root='docs/aprovacao-multicc/';
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const report=JSON.parse(readFileSync(root+'tests/resultados.json','utf8'));
report.verification.edge_cron='Deno 2.9.6 check --no-config --no-lock: exit 0, real dependencies; new duplicate property and preexisting PedidoLeve.DataHoraDigitacao type error fixed';
report.review.storage='26 HTTP checks passed on file + 26 on S3 MinIO; real GoTrue/PostgREST/Storage, synthetic nonadmin JWTs, real gateway handler with injected local dependencies, HTTP ERP simulator';
report.storage_integration_pending=[];
report.integration={file:'tests/integrated/resultados-http.json',s3:'tests/integrated/resultados-http-s3.json',unit_rerun:'111 passed; sidebar excluded (7 failures documented in previous full run)',production_acceptance:'not run',containers:'stopped; volumes preserved'};
report.deno={version:'2.9.6',command:'deno check --no-config --no-lock supabase/functions/sync-compras-status-cron/index.ts',exitCode:0,baseline:'HEAD reproduced TS2339 DataHoraDigitacao; modified file initially also TS2783 duplicate codigo_prod_unid_med',edge_sha256:sha('supabase/functions/sync-compras-status-cron/index.ts'),shared_sha256:sha('supabase/functions/_shared/requisicao-unidades.ts')};
report.unit_coverage={source:'tests/cobertura-unidades.json',read_only:true,requests:286,requests_without_items:11,items:363,products:171,products_with_cached_scale:3,products_without_cached_scale:168,known_unsupported_scalar_formats:0,limitation:'missing dimensional/dependency flags, cache from 2026-08-10; absent scales are unknown, not supported'};
if(existsSync(root+'tests/resultados-express.json')) {
 const e=JSON.parse(readFileSync(root+'tests/resultados-express.json','utf8'));
 const c=JSON.parse(readFileSync(root+'produto-load/classificacao.json','utf8'));
 report.continuacao_leitura={express_checks:e.results.length,express_failure:e.failure??null,express_evidence:'tests/resultados-express.json',produto_load:{chamadas:c.chamadas_nesta_execucao,conclusivas:c.conclusivas,inconclusivas:c.inconclusivas,bloqueio:c.bloqueio},gateway_origin_main:'76f67b2843061e7e9fb846ba8bac876901773585',patch_apply_check:'passed',render_live_sha:'unknown; public health has no SHA; no authenticated access available',acceptance_plan:'ACEITE-ALVO.md'};
}
writeFileSync(root+'tests/resultados.json',JSON.stringify(report,null,2)+'\n');
if(existsSync(root+'tests/render-live-confirmado.json')) {
 report.continuacao_leitura.render_live=JSON.parse(readFileSync(root+'tests/render-live-confirmado.json','utf8'));
 report.continuacao_leitura.render_live_sha='76f67b2; confirmado pelo usuário no painel Render';
 writeFileSync(root+'tests/resultados.json',JSON.stringify(report,null,2)+'\n');
}
const coverage=JSON.parse(readFileSync(root+'tests/cobertura-unidades.json','utf8'));
if(existsSync(root+'produto-load/analise-offline.json')) {
 const a=JSON.parse(readFileSync(root+'produto-load/analise-offline.json','utf8'));
 report.classificacao_offline={...a.resumo,modo:a.modo,validador_sha256:a.validador_sha256,evidencia:'produto-load/analise-offline.json',relatorio:'CLASSIFICACAO-UNIDADES.md'};
 writeFileSync(root+'tests/resultados.json',JSON.stringify(report,null,2)+'\n');
}
if(coverage.resultado_agregado.content) {
 const raw=JSON.parse(coverage.resultado_agregado.content[0].text).result;
 coverage.resultado_agregado=JSON.parse(raw.slice(raw.indexOf('\n[')+1,raw.lastIndexOf(']\n')+1));
 writeFileSync(root+'tests/cobertura-unidades.json',JSON.stringify(coverage,null,2)+'\n');
}
for(const file of ['ESTADO-APROVACAO-REQ.md','ESTADO-REVISAO-SUPRIMENTOS.md','PLANO-PEDIDOS.md']) {
 const old=readFileSync(file,'utf8');
 const updated=old.replace(/Deno integral e Storage HTTP\/S3 ainda não executados\.\r?\nDocker não encontrado no PATH; infraestrutura local e roteiro de Storage em ENTREGA\.md\./g,
 'Deno 2.9.6: check integral aprovado. Docker 29.1.3/Compose 2.40.3 instalados no WSL.\n26 testes HTTP com file e 26 com S3 MinIO passaram (Auth real, não-admin, ERP simulado).\n111 testes passaram novamente com sidebar excluído. Relatório/reprodução em ENTREGA.md.\nLevantamento somente SELECT: 171 produtos recentes, 3 com escala em cache, 168 sem escala;\nnão inferido suporte nem histórico. Aceite no Alvo real continua pendente.');
 if(updated!==old)writeFileSync(file,updated);
}
function git(args,allowed=[0]) {const r=spawnSync('git',args,{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});if(!allowed.includes(r.status))throw new Error(r.stderr);return r.stdout;}
const tracked=['ESTADO-APROVACAO-REQ.md','ESTADO-REVISAO-SUPRIMENTOS.md','PLANO-PEDIDOS.md','src/pages/SuprimentosAprovacoes.tsx','src/pages/SuprimentosRequisicaoDetalhe.tsx','src/pages/SuprimentosRequisicaoNova.tsx','src/services/requisicoesService.ts','src/test/identidade-requisicao.test.ts','supabase/functions/sync-compras-status-cron/index.ts'];
const added=['docs/aprovacao-multicc','src/components/compras/AprovacoesCC.tsx','src/components/compras/RateioCCEditor.tsx','src/lib/requisicaoCC.ts','src/test/gateway-requisicao.test.ts','src/test/requisicao-cc.test.tsx','src/test/requisicao-detalhe-multicc.test.tsx','src/test/requisicao-unidades-fluxo.test.ts','src/test/requisicao-unidades.test.ts','supabase/functions/_shared/requisicao-unidades.ts','supabase/migrations/20260907111805_aprovacao_requisicoes_todos_ccs.sql'];
added.push('src/components/compras/UnidadeRequisicaoSelect.tsx','src/test/requisicao-unidade-aviso.test.tsx');
report.aceite_preenchido={documento:'ACEITE-PREENCHIDO.md',cadastros:'tests/participantes-existentes.json',somente_select:true,autor:'caio.santos',aprovadora_final:'ana.sanches',ccs:['00010.00002.00005','00007.00001.00002'],alternativos:'indisponível: requer vínculo adicional autorizado',aviso_m3:'inline antes de avançar; preserva M3/3; sem conversão nova',testes_executados:{vitest_passed:113,excluded:'sidebar-ordem.test.tsx (7 falhas antigas no baseline)',frontend_tsc:'passed',build:'passed com avisos existentes'},browser_visual:'não executado nesta etapa'};
writeFileSync(root+'tests/resultados.json',JSON.stringify(report,null,2)+'\n');
const files=git(['ls-files','--others','--exclude-standard','--',...added]).trim().split('\n').filter(p=>p && p!==root+'diff-completo.patch');
let patch=git(['diff','--binary','--',...tracked]);
for(const file of files)patch+=git(['diff','--no-index','--binary','--','/dev/null',file],[0,1]);
writeFileSync(root+'diff-completo.patch',patch);
console.log(JSON.stringify({patch_bytes:Buffer.byteLength(patch),files:tracked.length+files.length,edge_sha256:report.deno.edge_sha256}));
