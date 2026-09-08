// Consulta somente leitura; credencial Git existente fica apenas em memória.
import {spawnSync} from 'node:child_process';
const c=spawnSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0'},timeout:15000});
if(c.status!==0)throw Error('Credencial GitHub indisponível; nenhum segredo foi exibido.');
const credential=Object.fromEntries(c.stdout.trim().split('\n').map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
if(!credential.password)throw Error('Credencial GitHub não retornou autenticação utilizável.');
const sha=process.argv[2]||'4ef34d50383343d2673b6dd702bccf26afeb3fda';
if(!/^[a-f0-9]{7,40}$/.test(sha))throw Error('SHA inválido');
for(const suffix of [`commits/${sha}/status`,`commits/${sha}/check-runs`,'deployments?per_page=3']) {
 const r=await fetch('https://api.github.com/repos/financeiropfbrazil/erp-proxy/'+suffix,{headers:{Authorization:'Bearer '+credential.password,Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(20000)});
 const body=await r.json();
 console.log(JSON.stringify({endpoint:suffix,status:r.status,state:body.state,statuses:body.statuses?.map(x=>({state:x.state,description:x.description,url:x.target_url,context:x.context})),checks:body.check_runs?.map(x=>({name:x.name,status:x.status,conclusion:x.conclusion,url:x.details_url})),deployments:Array.isArray(body)?body.map(x=>({id:x.id,sha:x.sha,environment:x.environment,created_at:x.created_at})):undefined}));
}
credential.password='';
