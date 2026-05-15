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
  // ─── Administração global ───────────────────────────────────────
  ADMIN_USERS_MANAGE: "admin.users.manage",
  // ─── Módulo Intercompany / Master ───────────────────────────────
  INTERCOMPANY_MASTER_VIEW_ALL: "intercompany.master.view_all",
  INTERCOMPANY_MASTER_CREATE_REEMBOLSO: "intercompany.master.create_reembolso",
  INTERCOMPANY_MASTER_VINCULAR_NF: "intercompany.master.vincular_nf",
  INTERCOMPANY_MASTER_EDIT_DESCRICAO: "intercompany.master.edit_descricao",
  INTERCOMPANY_MASTER_DELETE: "intercompany.master.delete",
  // ─── Módulo Intercompany / Reembolso NF ─────────────────────────
  INTERCOMPANY_REEMBOLSO_NF_VIEW_ALL: "intercompany.reembolso_nf.view_all",
  INTERCOMPANY_REEMBOLSO_NF_CREATE: "intercompany.reembolso_nf.create",
  INTERCOMPANY_REEMBOLSO_NF_EMIT_ALVO: "intercompany.reembolso_nf.emit_alvo",
  INTERCOMPANY_REEMBOLSO_NF_DELETE_RASCUNHO: "intercompany.reembolso_nf.delete_rascunho",
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
  RESPONSAVEL_PROJETO: "responsavel_projeto",
  APROVADOR_PROJETOS: "aprovador_projetos",
} as const;
export type RoleCode = (typeof ROLES)[keyof typeof ROLES];
