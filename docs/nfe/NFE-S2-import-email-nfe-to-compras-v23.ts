// Cópia da Edge import-email-nfe-to-compras v23 (publicada pelo Lovable em 06/04/2026), guardada na NFE-S2 (10/11/2026)
// antes de ela ser trocada pela versão que recusa tudo. Rollback = publicar este arquivo como index.ts (verify_jwt = true).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Modelo → tabela destino
const MODELO_DESTINO: Record<string, string> = {
  "nfe_55": "compras_nfe",
  "nfse": "compras_nfse",
  "nfcom_62": "compras_nfse",
  "cte_57": "compras_nfse",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { action, ids } = body;

    // action: "check" — check which NFs already exist in compras
    // action: "import" — import one or multiple NFs to compras
    // ids: array of email_notas_fiscais.id

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return new Response(JSON.stringify({ error: "ids array is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========================================
    // ACTION: check — verify which NFs already exist in compras
    // ========================================
    if (action === "check") {
      const { data: emailNfs } = await supabase
        .from("email_notas_fiscais")
        .select("id, chave_acesso, modelo")
        .in("id", ids);

      if (!emailNfs || emailNfs.length === 0) {
        return new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const results = [];

      for (const nf of emailNfs) {
        const destino = MODELO_DESTINO[nf.modelo] || null;
        let exists = false;

        if (nf.chave_acesso && destino) {
          const { data: existing } = await supabase
            .from(destino)
            .select("id")
            .eq("chave_acesso", nf.chave_acesso)
            .maybeSingle();
          exists = !!existing;
        }

        results.push({
          id: nf.id,
          chave_acesso: nf.chave_acesso,
          modelo: nf.modelo,
          destino,
          already_in_compras: exists,
        });
      }

      return new Response(JSON.stringify({ results }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ========================================
    // ACTION: import — import NFs to compras tables
    // ========================================
    if (action === "import") {
      const { data: emailNfs } = await supabase
        .from("email_notas_fiscais")
        .select("*")
        .in("id", ids)
        .in("status", ["pendente", "classificada"]);

      if (!emailNfs || emailNfs.length === 0) {
        return new Response(JSON.stringify({
          error: "No eligible NFs found (must be pendente or classificada)"
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const results = [];

      for (const nf of emailNfs) {
        const destino = MODELO_DESTINO[nf.modelo];

        if (!destino) {
          results.push({
            id: nf.id,
            success: false,
            error: `Modelo "${nf.modelo}" não tem destino em Compras`,
          });
          continue;
        }

        if (!nf.chave_acesso) {
          results.push({
            id: nf.id,
            success: false,
            error: "NF sem chave de acesso — não pode importar",
          });
          continue;
        }

        // Check if already exists in destino
        const { data: existing } = await supabase
          .from(destino)
          .select("id")
          .eq("chave_acesso", nf.chave_acesso)
          .maybeSingle();

        if (existing) {
          // Already exists — update email_notas_fiscais status to processada
          await supabase
            .from("email_notas_fiscais")
            .update({ status: "processada", processado_em: new Date().toISOString() })
            .eq("id", nf.id);

          results.push({
            id: nf.id,
            success: true,
            message: "Já existe em Compras — status atualizado para processada",
            destino,
            already_existed: true,
          });
          continue;
        }

        // Build record for destino table
        let record: Record<string, unknown> = {};

        if (destino === "compras_nfse") {
          record = {
            chave_acesso: nf.chave_acesso,
            numero: nf.numero_nota,
            serie: nf.serie,
            data_emissao: nf.data_emissao,
            situacao: "normal",
            tipo_documento: nf.modelo === "nfcom_62" ? "NFCOM" : nf.modelo === "cte_57" ? "CTE" : "NFSE",
            prestador_cnpj: nf.emitente_cnpj,
            prestador_nome: nf.emitente_nome,
            prestador_uf: nf.emitente_uf,
            prestador_municipio_nome: nf.emitente_municipio,
            tomador_cnpj: nf.destinatario_cnpj,
            tomador_nome: nf.destinatario_nome,
            valor_servico: nf.valor_total || 0,
            valor_liquido: nf.valor_total || 0,
            valor_iss: nf.valor_iss || 0,
            valor_pis: nf.valor_pis || 0,
            valor_cofins: nf.valor_cofins || 0,
            valor_retencao_irrf: nf.valor_retencoes || 0,
            raw_xml: nf.xml_content,
            status_lancamento: "pendente",
            origem: "email",
            email_nf_id: nf.id,
            xml_storage_path: nf.xml_storage_path,
            pdf_storage_path: nf.pdf_storage_path,
            imported_at: new Date().toISOString(),
          };
        } else if (destino === "compras_nfe") {
          record = {
            chave_acesso: nf.chave_acesso,
            numero: nf.numero_nota,
            serie: nf.serie,
            data_emissao: nf.data_emissao,
            tipo_operacao: "entrada",
            situacao: "autorizada",
            fornecedor_cnpj: nf.emitente_cnpj,
            fornecedor_nome: nf.emitente_nome,
            fornecedor_ie: nf.emitente_ie,
            fornecedor_uf: nf.emitente_uf,
            valor_total: nf.valor_total || 0,
            valor_produtos: nf.valor_produtos || 0,
            valor_frete: nf.valor_frete || 0,
            valor_desconto: nf.valor_desconto || 0,
            valor_icms: nf.valor_icms || 0,
            valor_ipi: nf.valor_ipi || 0,
            valor_pis: nf.valor_pis || 0,
            valor_cofins: nf.valor_cofins || 0,
            raw_xml: nf.xml_content,
            status_lancamento: "pendente",
            origem: "email",
            email_nf_id: nf.id,
            xml_storage_path: nf.xml_storage_path,
            pdf_storage_path: nf.pdf_storage_path,
            imported_at: new Date().toISOString(),
          };
        }

        // Insert into destino
        const { data: inserted, error: insertError } = await supabase
          .from(destino)
          .insert(record)
          .select("id")
          .single();

        if (insertError) {
          results.push({
            id: nf.id,
            success: false,
            error: insertError.message,
            destino,
          });
          continue;
        }

        // Update email_notas_fiscais status to processada
        await supabase
          .from("email_notas_fiscais")
          .update({
            status: "processada",
            processado_em: new Date().toISOString(),
            nf_entrada_id: inserted.id,
          })
          .eq("id", nf.id);

        results.push({
          id: nf.id,
          success: true,
          message: `Importada para ${destino === "compras_nfse" ? "Notas de Serviço" : "Notas Fiscais"}`,
          destino,
          compras_id: inserted.id,
        });
      }

      const successCount = results.filter((r: any) => r.success).length;
      const errorCount = results.filter((r: any) => !r.success).length;

      return new Response(JSON.stringify({
        success: errorCount === 0,
        total: results.length,
        imported: successCount,
        errors: errorCount,
        results,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action. Use 'check' or 'import'" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Import error:", error);
    return new Response(JSON.stringify({
      error: "Internal server error",
      details: error.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
