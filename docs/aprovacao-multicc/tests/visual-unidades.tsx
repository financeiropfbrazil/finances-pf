// Harness local: componentes reais, Load salvo, nenhuma autenticação ou rede ERP.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import { UnidadeRequisicaoSelect, posicaoInicialUnidade } from '@/components/compras/UnidadeRequisicaoSelect';
import { RateioCCEditor } from '@/components/compras/RateioCCEditor';
import { unidadesProduto, converterSolicitada } from '../../../supabase/functions/_shared/requisicao-unidades';
import load from '../produto-load/respostas/001.013.00382.json';
import m3 from '../produto-load/respostas/001.017.092.json';
const query = new URLSearchParams(location.search);
document.documentElement.classList.toggle('dark', query.get('theme') === 'dark');
function Sample({ blocked = false }: { blocked?: boolean }) {
 const units = unidadesProduto(blocked ? m3.data : load.data, blocked ? '001.017.092' : '001.013.00382');
 const [position, setPosition] = useState(posicaoInicialUnidade(units));
 return <section className="space-y-3 rounded-lg border bg-card p-5 text-card-foreground">
  <h2>{blocked ? '001.017.092 — compras M3 preservada' : '001.013.00382 — produto do aceite'}</h2>
  <UnidadeRequisicaoSelect unidades={units} posicao={position} onChange={setPosition} carregando={false} />
  {!blocked && <p data-testid="quantidades">{[10,20].map(n => `${n} → ${converterSolicitada(n, units.find(u => u.posicao === position)!)}`).join(' | ')}</p>}
 </section>;
}
function App() {
 const [retry, setRetry] = useState(0);
 const [distribution, setDistribution] = useState([{codigo_classe_rec_desp:'13.07',percentual:100,ccs:[{codigo_centro_ctrl:'00010.00002.00005',percentual:100}]}]);
 return <main className="mx-auto max-w-3xl space-y-5 bg-background p-6 text-foreground">
  <h1 className="text-xl font-semibold">Unidades e centros de custo — {query.get('theme') || 'light'}</h1>
  <Sample /> <Sample blocked />
  <section className="space-y-3 rounded-lg border bg-card p-5 text-card-foreground"><h2>Consulta pendente (simulada)</h2>
   <UnidadeRequisicaoSelect unidades={[]} posicao={null} onChange={()=>{}} carregando />
  </section>
  <section className="space-y-3 rounded-lg border bg-card p-5 text-card-foreground"><h2>Falha de rede (simulada)</h2>
   <UnidadeRequisicaoSelect unidades={[]} posicao={null} onChange={()=>{}} carregando={false} erro={new Error('Consulta excedeu 45 segundos.')} onRetry={()=>setRetry(retry+1)} />
   <p data-testid="retry">Tentativas: {retry}</p>
  </section>
  <RateioCCEditor value={distribution} onChange={setDistribution} classes={[{codigo:'13.07',nome:'Material de consumo'}]} centros={[{erp_code:'00010.00002.00005',name:'Engenharia de Manufatura'},{erp_code:'00007.00001.00002',name:'Marketing e Comunicação'}]} />
 </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
