// supabase/functions/import-email-nfe-to-compras/index.ts
//
// APOSENTADA (PLANO-NFE NFE-S2, 10/11/2026). A tela "Email NF-e" está parada desde 14/05/2026 e saiu do menu; esta
// função importava notas de `email_notas_fiscais` para `compras_nfe` / `compras_nfse` com a chave de serviço e
// aceitava a chave pública do app (sem usuário) — para NF-e nem funcionava (gravava colunas que não existem).
// Agora recusa tudo com 410. A versão anterior (v23) está em docs/nfe/NFE-S2-import-email-nfe-to-compras-v23.ts:
// rollback = publicar aquele arquivo como index.ts (verify_jwt = true).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return new Response(
    JSON.stringify({
      error: "Função aposentada (PLANO-NFE NFE-S2): a importação de notas recebidas por e-mail foi desligada.",
    }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
