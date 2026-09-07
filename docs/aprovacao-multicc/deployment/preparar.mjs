// Gera o SQL integral, preservando uma única transação; não conecta à produção.
import {readFileSync,writeFileSync} from 'node:fs';
const main=readFileSync('supabase/migrations/20260907111805_aprovacao_requisicoes_todos_ccs.sql','utf8');
const gate=readFileSync('supabase/migrations/20260907160220_requisicoes_janela_aceite.sql','utf8');
if(!/^begin;/im.test(main) || !/commit;\s*$/i.test(main) || !/^begin;/i.test(gate.trim()))throw Error('Limites de transação inesperados');
const combined=main.replace(/commit;\s*$/i,'')+gate.replace(/^\s*begin;/i,'').replace(/commit;\s*$/i,'')+
 '\ndrop trigger if exists trg_req_implantacao_suspensa on public.compras_requisicoes;\ndrop function if exists public.req_implantacao_suspensa();\ncommit;\n';
writeFileSync('docs/aprovacao-multicc/deployment/SQL-INTEGRAL.sql',combined);
console.log('SQL integral gerado; nenhuma conexão realizada.');
