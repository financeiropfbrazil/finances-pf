import { callAlvo } from "../alvo-client";
import { unidadesProduto, validarItemCadastro } from "./req-unidades";
// Copiar para erp-proxy/src/routes/req-aprovada.ts na futura aplicação do patch.
import { createHash } from "node:crypto";
import { Router } from "express";
import { getSupabaseAdmin } from "../supabase-client";
import { getAlvoToken } from "../alvo-auth";
import { montarReqAprovada, type SnapshotEnvio } from "./req-aprovada-payload";

const router = Router();

// Bloqueia as DUAS rotas livres antes dos handlers legados e antes do multer.
router.post(["/insert", "/insert-multipart"], (_req, res) => {
  res.status(409).json({ error: "Criação exige aprovação por todos os CCs. Atualize o Hub e use /req-comp/enviar-aprovada." });
});

router.post("/enviar-aprovada", async (req, res) => {
  if (req.user?.source !== "financial_hub" || !req.user?.id) {
    res.status(403).json({ error: "Exige usuário autenticado do Financial Hub." });
    return;
  }
  const id = req.body?.requisicao_id;
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    res.status(400).json({ error: "requisicao_id inválido." });
    return;
  }
  let snapshot: SnapshotEnvio | undefined;
  let chamadaIniciada = false;
  let numeroConfirmado: string | null = null;
  try {
    if (process.env.SUPABASE_URL?.replace(/\/$/, "") !== "https://hbtggrbauguukewiknew.supabase.co") throw new Error("Projeto Supabase incorreto no gateway");
    const db = getSupabaseAdmin();
    const { data, error } = await db.rpc("iniciar_envio_requisicao", { p_req_id: id, p_user_id: req.user.id });
    if (error) { res.status(409).json({ error: error.message }); return; }
    snapshot = data as SnapshotEnvio;
    const cadastros = new Map<string, ReturnType<typeof unidadesProduto>>();
    for (const item of snapshot.itens) {
      if (!cadastros.has(item.codigo_produto)) {
        const produto = await callAlvo(`Produto/Load?codigo=${encodeURIComponent(item.codigo_produto)}&loadChild=All`, "GET");
        if (!produto.ok) throw new Error(`Não foi possível conferir unidades do produto ${item.codigo_produto}`);
        cadastros.set(item.codigo_produto, unidadesProduto(produto.data, item.codigo_produto));
      }
      validarItemCadastro(item, cadastros.get(item.codigo_produto)!);
    }
    const payload = montarReqAprovada(snapshot);
    const arquivos = snapshot.arquivos;
    let body: string | FormData = JSON.stringify(payload);
    if (arquivos.length) {
      const form = new FormData();
      form.append("obj", JSON.stringify(payload));
      for (const a of arquivos) {
        if (!a.storage_path.startsWith(`${id}/`)) throw new Error("Anexo fora da pasta da requisição");
        const { data: blob, error: erroArquivo } = await db.storage.from("compras-requisicoes").download(a.storage_path);
        if (erroArquivo || !blob) throw new Error(`Não foi possível baixar ${a.nome_original}`);
        const digest = createHash("sha256").update(Buffer.from(await blob.arrayBuffer())).digest("hex");
        if (!a.conteudo_sha256 || digest !== a.conteudo_sha256) throw new Error(`Integridade do anexo divergente: ${a.nome_original}`);
        form.append(`${a.upload_identify_guid}#Arquivo`, blob, a.nome_original);
      }
      body = form;
    }
    const token = await getAlvoToken();
    const base = process.env.ALVO_BASE_URL;
    if (!base) throw new Error("ALVO_BASE_URL não configurado");
    // Uma única chamada. Nem 409 nem timeout autorizam repetir um Insert.
    chamadaIniciada = true;
    const response = await fetch(`${base.replace(/\/$/, "")}/ReqComp/${arquivos.length ? "SaveMultiPart" : "SavePartial"}?action=Insert`, {
      method: "POST", headers: { "riosoft-token": token, ...(typeof body === "string" ? { "Content-Type": "application/json" } : {}) },
      body, signal: AbortSignal.timeout(120_000),
    });
    const result = await response.json() as { Numero?: string; Message?: string };
    if (response.ok && typeof result.Numero === "string" && result.Numero.trim()) numeroConfirmado = result.Numero.trim();
    // Só validação explícita do Alvo (412) prova ausência de criação após o HTTP.
    const definitiva = response.status === 412 && !result.Numero;
    const mensagem = numeroConfirmado ? null : (result.Message || `Envio sem confirmação (HTTP ${response.status}). Reconciliar antes de reenviar.`);
    const { error: erroFim } = await db.rpc("concluir_envio_requisicao", {
      p_req_id: id, p_token: snapshot.token, p_numero: numeroConfirmado, p_erro: mensagem, p_falha_definitiva: definitiva,
    });
    if (erroFim) throw new Error(`Falha ao registrar desfecho: ${erroFim.message}`);
    if (!numeroConfirmado) { res.status(definitiva ? 422 : 502).json({ error: mensagem }); return; }
    res.status(200).json({ Numero: numeroConfirmado });
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    if (snapshot) {
      // Se o ERP confirmou, repetir somente a persistência é seguro (RPC idempotente).
      try {
        const { error } = await getSupabaseAdmin().rpc("concluir_envio_requisicao", {
          p_req_id: id, p_token: snapshot.token, p_numero: numeroConfirmado,
          p_erro: mensagem, p_falha_definitiva: !chamadaIniciada,
        });
        if (error) console.error("[req-aprovada] desfecho não registrado", id, error.message);
        else if (numeroConfirmado) { res.status(200).json({ Numero: numeroConfirmado }); return; }
      } catch (persistError) { console.error("[req-aprovada] desfecho incerto", id, persistError); }
    }
    res.status(502).json({ error: numeroConfirmado
      ? `Requisição criada no Alvo (${numeroConfirmado}), mas sem confirmação no Hub. NÃO reenvie; reconciliar. ${mensagem}`
      : mensagem });
  }
});

export default router;
