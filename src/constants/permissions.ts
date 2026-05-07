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
} as const;

export type RoleCode = (typeof ROLES)[keyof typeof ROLES];
