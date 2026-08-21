/**
 * Catálogo de códigos de permissão do Financial Hub.
 *
 * Sempre que criar uma permissão nova na tabela `hub_permissions`,
 * adicionar o código aqui também. Isso evita typos e dá autocomplete
 * no TypeScript quando usar `useHasPermission(PERMISSIONS.X)`.
 *
 * Convenção de código: {modulo}.{recurso}.{acao}
 */
export const PERMISSIONS = {
  // ─── Módulo Compras / Requisições ───────────────────────────────
  COMPRAS_REQUISICOES_VIEW_OWN: "compras.requisicoes.view_own",
  COMPRAS_REQUISICOES_VIEW_ALL: "compras.requisicoes.view_all",
  COMPRAS_REQUISICOES_CREATE: "compras.requisicoes.create",
  COMPRAS_REQUISICOES_DELETE_OWN: "compras.requisicoes.delete_own",
  COMPRAS_REQUISICOES_REENVIAR_OWN: "compras.requisicoes.reenviar_own",
  // Gate de aprovação por líder de departamento (Fase 1 no banco desde 07/08/2026).
  COMPRAS_REQUISICOES_APROVAR: "compras.requisicoes.aprovar",
  // ─── Módulo Compras / Pedidos ───────────────────────────────────
  COMPRAS_PEDIDOS_ACCESS: "compras.pedidos.access",
  COMPRAS_PEDIDOS_VIEW_ALL: "compras.pedidos.view_all",
  COMPRAS_PEDIDOS_CREATE: "compras.pedidos.create",
  COMPRAS_PEDIDOS_DELETE_DRAFT: "compras.pedidos.delete_draft",
  COMPRAS_PEDIDOS_VIEW_OWN: "compras.pedidos.view_own" as const,
  // ─── Administração global ───────────────────────────────────────
  ADMIN_USERS_MANAGE: "admin.users.manage",

  // ─── Módulo Intercompany / Master ───────────────────────────────
  INTERCOMPANY_MASTER_VIEW_ALL: "intercompany.master.view_all",
  INTERCOMPANY_MASTER_CREATE_REEMBOLSO: "intercompany.master.create_reembolso",
  INTERCOMPANY_MASTER_VINCULAR_NF: "intercompany.master.vincular_nf",
  INTERCOMPANY_MASTER_EDIT_DESCRICAO: "intercompany.master.edit_descricao",
  INTERCOMPANY_MASTER_DELETE: "intercompany.master.delete",

  // ─── Módulo Intercompany / Reembolso NF (Frente 3) ──────────────
  INTERCOMPANY_REEMBOLSO_NF_VIEW_ALL: "intercompany.reembolso_nf.view_all",
  INTERCOMPANY_REEMBOLSO_NF_CREATE: "intercompany.reembolso_nf.create",
  INTERCOMPANY_REEMBOLSO_NF_EMIT_ALVO: "intercompany.reembolso_nf.emit_alvo",
  INTERCOMPANY_REEMBOLSO_NF_DELETE_RASCUNHO: "intercompany.reembolso_nf.delete_rascunho",

  // ─── Módulo Intercompany / Reembolso Manual (Frente 4) ──────────
  INTERCOMPANY_REEMBOLSO_MANUAL_VIEW_ALL: "intercompany.reembolso_manual.view_all",
  INTERCOMPANY_REEMBOLSO_MANUAL_CREATE: "intercompany.reembolso_manual.create",
  INTERCOMPANY_REEMBOLSO_MANUAL_EMIT_ALVO: "intercompany.reembolso_manual.emit_alvo",
  INTERCOMPANY_REEMBOLSO_MANUAL_DELETE_RASCUNHO: "intercompany.reembolso_manual.delete_rascunho",

  // ─── Módulo Projetos ────────────────────────────────────────────
  PROJETOS_ACCESS: "projetos.access",
  PROJETOS_CREATE: "projetos.create",
  PROJETOS_EDIT_OWN: "projetos.edit_own",
  PROJETOS_DELETE_OWN: "projetos.delete_own",
  PROJETOS_VIEW_OWN: "projetos.view_own",
  PROJETOS_VIEW_ALL: "projetos.view_all",
  PROJETOS_APPROVE: "projetos.approve",
  PROJETOS_PEDIDOS_CREATE: "projetos.pedidos.create",
  PROJETOS_PEDIDOS_REENVIAR: "projetos.pedidos.reenviar",

  // ─── Módulo Ferramentas ─────────────────────────────────────────
  FERRAMENTAS_ACCESS: "ferramentas.access",
  FERRAMENTAS_BULK_EDIT_EXECUTE: "ferramentas.bulk_edit.execute",
  FERRAMENTAS_BULK_EDIT_RESTORE: "ferramentas.bulk_edit.restore",
  FERRAMENTAS_CRON_VIEW: "ferramentas.cron.view",

  // ─── Módulo Produção (Ordem de Produção) ────────────────────────
  PRODUCAO_ACCESS: "producao.access",
  PRODUCAO_ORDENS_CREATE: "producao.ordens.create",
  PRODUCAO_ORDENS_MANAGE: "producao.ordens.manage",

  // ─── Módulo Produção / Requisição de Material (RM) ──────────────
  // Já existem no banco e mapeadas a admin + gestor_producao +
  // operador_producao (a `atender`, só a admin). `CREATE` e `ATENDER` ficam
  // declaradas aqui sem uso: a criação é a próxima etapa e o atendimento
  // depende do endpoint de lotes disponíveis (BL-21).
  PRODUCAO_RM_ACCESS: "producao.rm.access",
  PRODUCAO_RM_CREATE: "producao.rm.create",
  PRODUCAO_RM_ATENDER: "producao.rm.atender",

  // ─── Módulo Movimentação de Salas ───────────────────────────────
  // As 8 existem no banco desde a FS1-6/FS2-7 e estão mapeadas aos 4 papéis
  // do módulo + `admin`. ATENÇÃO: ter a permissão não basta para registrar —
  // a RPC cobra também vínculo ativo com a sala (`prod_sala_usuarios`), via
  // `user_has_sala_permission`. Papel dá o verbo, vínculo dá o lugar.
  // `SALAS_BATELADA_MANAGE` fica declarada sem uso na UI: a batelada dorme
  // desde o Ajuste B (MVP de três eventos).
  SALAS_ACCESS: "salas.access",
  SALAS_REGISTRAR_ENTRADA: "salas.registrar.entrada",
  SALAS_REGISTRAR_REFUGO: "salas.registrar.refugo",
  SALAS_REGISTRAR_SAIDA: "salas.registrar.saida",
  SALAS_ESTORNAR: "salas.estornar",
  SALAS_CADASTROS_MANAGE: "salas.cadastros.manage",
  SALAS_DASHBOARD_VIEW: "salas.dashboard.view",
  SALAS_BATELADA_MANAGE: "salas.batelada.manage",
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * Catálogo de códigos de papéis do Financial Hub.
 *
 * Sempre que criar um papel novo na tabela `hub_roles`,
 * adicionar aqui também.
 */
export const ROLES = {
  ADMIN: "admin",
  ANALISTA_COMPRAS: "analista_compras",
  REQUISITANTE: "requisitante",
  LIDER_DEPARTAMENTO: "lider_departamento",
  RESPONSAVEL_PROJETO: "responsavel_projeto",
  APROVADOR_PROJETOS: "aprovador_projetos",
  CONTROLLER_INTERCOMPANY: "controller_intercompany",
  FINANCEIRO: "financeiro",
  OPERADOR_PRODUCAO: "operador_producao",
  GESTOR_PRODUCAO: "gestor_producao",
  OPERADOR_SALAS: "operador_salas",
  QUALIDADE_SALAS: "qualidade_salas",
  GESTOR_SALAS: "gestor_salas",
  VISUALIZADOR_SALAS: "visualizador_salas",
} as const;

export type RoleCode = (typeof ROLES)[keyof typeof ROLES];
