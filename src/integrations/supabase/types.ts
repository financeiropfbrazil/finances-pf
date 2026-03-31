export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      balancete_accounts: {
        Row: {
          account_code: string
          account_number: number | null
          account_type: string
          created_at: string | null
          credit: number | null
          current_balance: number | null
          debit: number | null
          description: string
          id: string
          period_id: string
          previous_balance: number | null
          upload_id: string
        }
        Insert: {
          account_code: string
          account_number?: number | null
          account_type: string
          created_at?: string | null
          credit?: number | null
          current_balance?: number | null
          debit?: number | null
          description: string
          id?: string
          period_id: string
          previous_balance?: number | null
          upload_id: string
        }
        Update: {
          account_code?: string
          account_number?: number | null
          account_type?: string
          created_at?: string | null
          credit?: number | null
          current_balance?: number | null
          debit?: number | null
          description?: string
          id?: string
          period_id?: string
          previous_balance?: number | null
          upload_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "balancete_accounts_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "balancete_accounts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "balancete_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      balancete_module_mapping: {
        Row: {
          account_code_pattern: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          match_type: string | null
          module_name: string
          target_field: string
          target_table: string
        }
        Insert: {
          account_code_pattern: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          match_type?: string | null
          module_name: string
          target_field: string
          target_table: string
        }
        Update: {
          account_code_pattern?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          match_type?: string | null
          module_name?: string
          target_field?: string
          target_table?: string
        }
        Relationships: []
      }
      balancete_uploads: {
        Row: {
          created_at: string | null
          error_message: string | null
          file_name: string
          id: string
          period_id: string
          status: string | null
          total_accounts: number | null
          total_analytical: number | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          file_name: string
          id?: string
          period_id: string
          status?: string | null
          total_accounts?: number | null
          total_analytical?: number | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          file_name?: string
          id?: string
          period_id?: string
          status?: string | null
          total_accounts?: number | null
          total_analytical?: number | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "balancete_uploads_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: true
            referencedRelation: "periods"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_accounts: {
        Row: {
          account_number: string | null
          account_type: string
          accounting_account_code: string
          accounting_balance: number
          bank_name: string
          bank_statement_balance: number
          created_at: string
          difference: number | null
          id: string
          justification: string | null
          period_id: string
          responsible_user: string | null
          status: string
          updated_at: string
        }
        Insert: {
          account_number?: string | null
          account_type?: string
          accounting_account_code: string
          accounting_balance?: number
          bank_name: string
          bank_statement_balance?: number
          created_at?: string
          difference?: number | null
          id?: string
          justification?: string | null
          period_id: string
          responsible_user?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          account_number?: string | null
          account_type?: string
          accounting_account_code?: string
          accounting_balance?: number
          bank_name?: string
          bank_statement_balance?: number
          created_at?: string
          difference?: number | null
          id?: string
          justification?: string | null
          period_id?: string
          responsible_user?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "periods"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_statement_transactions: {
        Row: {
          amount: number
          bank_code: string
          created_at: string
          fit_id: string
          id: string
          matched_erp_id: string | null
          memo: string | null
          period_id: string
          status: string
          transaction_date: string
          updated_at: string
        }
        Insert: {
          amount: number
          bank_code?: string
          created_at?: string
          fit_id: string
          id?: string
          matched_erp_id?: string | null
          memo?: string | null
          period_id: string
          status?: string
          transaction_date: string
          updated_at?: string
        }
        Update: {
          amount?: number
          bank_code?: string
          created_at?: string
          fit_id?: string
          id?: string
          matched_erp_id?: string | null
          memo?: string | null
          period_id?: string
          status?: string
          transaction_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_transactions_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "periods"
            referencedColumns: ["id"]
          },
        ]
      }
      classes_rec_desp: {
        Row: {
          codigo: string
          conta_contabil_classificacao: string | null
          conta_contabil_reduzida: number | null
          created_at: string | null
          grupo: string | null
          id: string
          is_active: boolean | null
          natureza: string | null
          nivel: string | null
          nome: string
          updated_at: string | null
        }
        Insert: {
          codigo: string
          conta_contabil_classificacao?: string | null
          conta_contabil_reduzida?: number | null
          created_at?: string | null
          grupo?: string | null
          id?: string
          is_active?: boolean | null
          natureza?: string | null
          nivel?: string | null
          nome: string
          updated_at?: string | null
        }
        Update: {
          codigo?: string
          conta_contabil_classificacao?: string | null
          conta_contabil_reduzida?: number | null
          created_at?: string | null
          grupo?: string | null
          id?: string
          is_active?: boolean | null
          natureza?: string | null
          nivel?: string | null
          nome?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      commodatum_contracts: {
        Row: {
          contract_name: string
          created_at: string
          end_date: string | null
          file_name: string | null
          file_path: string | null
          id: string
          notes: string | null
          object_description: string
          period_id: string
          start_date: string
          status: string
          updated_at: string
          value: number
        }
        Insert: {
          contract_name: string
          created_at?: string
          end_date?: string | null
          file_name?: string | null
          file_path?: string | null
          id?: string
          notes?: string | null
          object_description?: string
          period_id: string
          start_date: string
          status?: string
          updated_at?: string
          value?: number
        }
        Update: {
          contract_name?: string
          created_at?: string
          end_date?: string | null
          file_name?: string | null
          file_path?: string | null
          id?: string
          notes?: string | null
          object_description?: string
          period_id?: string
          start_date?: string
          status?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "commodatum_contracts_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "periods"
            referencedColumns: ["id"]
          },
        ]
      }
      compras_config: {
        Row: {
          chave: string
          id: string
          updated_at: string | null
          valor: string | null
        }
        Insert: {
          chave: string
          id?: string
          updated_at?: string | null
          valor?: string | null
        }
        Update: {
          chave?: string
          id?: string
          updated_at?: string | null
          valor?: string | null
        }
        Relationships: []
      }
      compras_entidades_cache: {
        Row: {
          cnpj: string | null
          codigo_alternativo: string | null
          codigo_entidade: string
          id: string
          ie: string | null
          municipio: string | null
          nome: string | null
          uf: string | null
          updated_at: string | null
        }
        Insert: {
          cnpj?: string | null
          codigo_alternativo?: string | null
          codigo_entidade: string
          id?: string
          ie?: string | null
          municipio?: string | null
          nome?: string | null
          uf?: string | null
          updated_at?: string | null
        }
        Update: {
          cnpj?: string | null
          codigo_alternativo?: string | null
          codigo_entidade?: string
          id?: string
          ie?: string | null
          municipio?: string | null
          nome?: string | null
          uf?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      compras_lancamento_auditoria: {
        Row: {
          campo: string
          compras_nfse_id: string | null
          created_at: string | null
          id: string
          numero_nfse: string | null
          pedido_numero: string | null
          usuario: string | null
          valor_anterior: string | null
          valor_novo: string | null
        }
        Insert: {
          campo: string
          compras_nfse_id?: string | null
          created_at?: string | null
          id?: string
          numero_nfse?: string | null
          pedido_numero?: string | null
          usuario?: string | null
          valor_anterior?: string | null
          valor_novo?: string | null
        }
        Update: {
          campo?: string
          compras_nfse_id?: string | null
          created_at?: string | null
          id?: string
          numero_nfse?: string | null
          pedido_numero?: string | null
          usuario?: string | null
          valor_anterior?: string | null
          valor_novo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compras_lancamento_auditoria_compras_nfse_id_fkey"
            columns: ["compras_nfse_id"]
            isOneToOne: false
            referencedRelation: "compras_nfse"
            referencedColumns: ["id"]
          },
        ]
      }
      compras_nfe: {
        Row: {
          chave_acesso: string
          created_at: string | null
          data_emissao: string | null
          data_entrada: string | null
          erp_chave_movestq: number | null
          erro_envio: string | null
          fornecedor_cnpj: string | null
          fornecedor_ie: string | null
          fornecedor_nome: string | null
          fornecedor_uf: string | null
          id: string
          imported_at: string | null
          lancado_em: string | null
          lancado_por: string | null
          manifestacao: string | null
          nsu: string | null
          numero: string | null
          pedido_compra_centro_custo: string | null
          pedido_compra_classe: string | null
          pedido_compra_cond_pagamento: string | null
          pedido_compra_entidade: string | null
          pedido_compra_numero: string | null
          pedido_compra_valor: number | null
          raw_json: Json | null
          raw_xml: string | null
          schema_type: string | null
          serie: string | null
          situacao: string | null
          status_lancamento: string | null
          tipo_operacao: string | null
          updated_at: string | null
          valor_cofins: number | null
          valor_desconto: number | null
          valor_frete: number | null
          valor_icms: number | null
          valor_ipi: number | null
          valor_pis: number | null
          valor_produtos: number | null
          valor_total: number | null
        }
        Insert: {
          chave_acesso: string
          created_at?: string | null
          data_emissao?: string | null
          data_entrada?: string | null
          erp_chave_movestq?: number | null
          erro_envio?: string | null
          fornecedor_cnpj?: string | null
          fornecedor_ie?: string | null
          fornecedor_nome?: string | null
          fornecedor_uf?: string | null
          id?: string
          imported_at?: string | null
          lancado_em?: string | null
          lancado_por?: string | null
          manifestacao?: string | null
          nsu?: string | null
          numero?: string | null
          pedido_compra_centro_custo?: string | null
          pedido_compra_classe?: string | null
          pedido_compra_cond_pagamento?: string | null
          pedido_compra_entidade?: string | null
          pedido_compra_numero?: string | null
          pedido_compra_valor?: number | null
          raw_json?: Json | null
          raw_xml?: string | null
          schema_type?: string | null
          serie?: string | null
          situacao?: string | null
          status_lancamento?: string | null
          tipo_operacao?: string | null
          updated_at?: string | null
          valor_cofins?: number | null
          valor_desconto?: number | null
          valor_frete?: number | null
          valor_icms?: number | null
          valor_ipi?: number | null
          valor_pis?: number | null
          valor_produtos?: number | null
          valor_total?: number | null
        }
        Update: {
          chave_acesso?: string
          created_at?: string | null
          data_emissao?: string | null
          data_entrada?: string | null
          erp_chave_movestq?: number | null
          erro_envio?: string | null
          fornecedor_cnpj?: string | null
          fornecedor_ie?: string | null
          fornecedor_nome?: string | null
          fornecedor_uf?: string | null
          id?: string
          imported_at?: string | null
          lancado_em?: string | null
          lancado_por?: string | null
          manifestacao?: string | null
          nsu?: string | null
          numero?: string | null
          pedido_compra_centro_custo?: string | null
          pedido_compra_classe?: string | null
          pedido_compra_cond_pagamento?: string | null
          pedido_compra_entidade?: string | null
          pedido_compra_numero?: string | null
          pedido_compra_valor?: number | null
          raw_json?: Json | null
          raw_xml?: string | null
          schema_type?: string | null
          serie?: string | null
          situacao?: string | null
          status_lancamento?: string | null
          tipo_operacao?: string | null
          updated_at?: string | null
          valor_cofins?: number | null
          valor_desconto?: number | null
          valor_frete?: number | null
          valor_icms?: number | null
          valor_ipi?: number | null
          valor_pis?: number | null
          valor_produtos?: number | null
          valor_total?: number | null
        }
        Relationships: []
      }
      compras_nfe_itens: {
        Row: {
          cfop: string | null
          codigo_produto: string | null
          compras_nfe_id: string
          created_at: string | null
          descricao: string | null
          id: string
          ncm: string | null
          numero_item: number | null
          quantidade: number | null
          unidade: string | null
          valor_cofins: number | null
          valor_desconto: number | null
          valor_icms: number | null
          valor_ipi: number | null
          valor_pis: number | null
          valor_total: number | null
          valor_unitario: number | null
        }
        Insert: {
          cfop?: string | null
          codigo_produto?: string | null
          compras_nfe_id: string
          created_at?: string | null
          descricao?: string | null
          id?: string
          ncm?: string | null
          numero_item?: number | null
          quantidade?: number | null
          unidade?: string | null
          valor_cofins?: number | null
          valor_desconto?: number | null
          valor_icms?: number | null
          valor_ipi?: number | null
          valor_pis?: number | null
          valor_total?: number | null
          valor_unitario?: number | null
        }
        Update: {
          cfop?: string | null
          codigo_produto?: string | null
          compras_nfe_id?: string
          created_at?: string | null
          descricao?: string | null
          id?: string
          ncm?: string | null
          numero_item?: number | null
          quantidade?: number | null
          unidade?: string | null
          valor_cofins?: number | null
          valor_desconto?: number | null
          valor_icms?: number | null
          valor_ipi?: number | null
          valor_pis?: number | null
          valor_total?: number | null
          valor_unitario?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "compras_nfe_itens_compras_nfe_id_fkey"
            columns: ["compras_nfe_id"]
            isOneToOne: false
            referencedRelation: "compras_nfe"
            referencedColumns: ["id"]
          },
        ]
      }
      compras_nfse: {
        Row: {
          aliquota_iss: number | null
          base_calculo_iss: number | null
          chave_acesso: string
          cnae: string | null
          codigo_servico: string | null
          created_at: string | null
          data_competencia: string | null
          data_emissao: string | null
          descricao_servico: string | null
          erp_chave_movestq: number | null
          id: string
          imported_at: string | null
          iss_retido: boolean | null
          lancado_em: string | null
          lancado_por: string | null
          municipio_incidencia_codigo: string | null
          municipio_incidencia_nome: string | null
          natureza_tributacao: string | null
          nsu: number | null
          numero: string | null
          pedido_compra_centro_custo: string | null
          pedido_compra_classe: string | null
          pedido_compra_cond_pagamento: string | null
          pedido_compra_entidade: string | null
          pedido_compra_numero: string | null
          pedido_compra_valor: number | null
          prestador_cnpj: string | null
          prestador_cpf: string | null
          prestador_inscricao_municipal: string | null
          prestador_municipio_codigo: string | null
          prestador_municipio_nome: string | null
          prestador_nome: string | null
          prestador_uf: string | null
          raw_json: Json | null
          raw_xml: string | null
          serie: string | null
          situacao: string | null
          status_lancamento: string | null
          tipo_documento: string | null
          tipo_evento: string | null
          tomador_cnpj: string | null
          tomador_cpf: string | null
          tomador_nome: string | null
          updated_at: string | null
          valor_cofins: number | null
          valor_deducoes: number | null
          valor_desconto_condicionado: number | null
          valor_desconto_incondicionado: number | null
          valor_iss: number | null
          valor_iss_retido: number | null
          valor_liquido: number | null
          valor_pis: number | null
          valor_retencao_csll: number | null
          valor_retencao_inss: number | null
          valor_retencao_irrf: number | null
          valor_servico: number | null
          valor_total_retencoes: number | null
        }
        Insert: {
          aliquota_iss?: number | null
          base_calculo_iss?: number | null
          chave_acesso: string
          cnae?: string | null
          codigo_servico?: string | null
          created_at?: string | null
          data_competencia?: string | null
          data_emissao?: string | null
          descricao_servico?: string | null
          erp_chave_movestq?: number | null
          id?: string
          imported_at?: string | null
          iss_retido?: boolean | null
          lancado_em?: string | null
          lancado_por?: string | null
          municipio_incidencia_codigo?: string | null
          municipio_incidencia_nome?: string | null
          natureza_tributacao?: string | null
          nsu?: number | null
          numero?: string | null
          pedido_compra_centro_custo?: string | null
          pedido_compra_classe?: string | null
          pedido_compra_cond_pagamento?: string | null
          pedido_compra_entidade?: string | null
          pedido_compra_numero?: string | null
          pedido_compra_valor?: number | null
          prestador_cnpj?: string | null
          prestador_cpf?: string | null
          prestador_inscricao_municipal?: string | null
          prestador_municipio_codigo?: string | null
          prestador_municipio_nome?: string | null
          prestador_nome?: string | null
          prestador_uf?: string | null
          raw_json?: Json | null
          raw_xml?: string | null
          serie?: string | null
          situacao?: string | null
          status_lancamento?: string | null
          tipo_documento?: string | null
          tipo_evento?: string | null
          tomador_cnpj?: string | null
          tomador_cpf?: string | null
          tomador_nome?: string | null
          updated_at?: string | null
          valor_cofins?: number | null
          valor_deducoes?: number | null
          valor_desconto_condicionado?: number | null
          valor_desconto_incondicionado?: number | null
          valor_iss?: number | null
          valor_iss_retido?: number | null
          valor_liquido?: number | null
          valor_pis?: number | null
          valor_retencao_csll?: number | null
          valor_retencao_inss?: number | null
          valor_retencao_irrf?: number | null
          valor_servico?: number | null
          valor_total_retencoes?: number | null
        }
        Update: {
          aliquota_iss?: number | null
          base_calculo_iss?: number | null
          chave_acesso?: string
          cnae?: string | null
          codigo_servico?: string | null
          created_at?: string | null
          data_competencia?: string | null
          data_emissao?: string | null
          descricao_servico?: string | null
          erp_chave_movestq?: number | null
          id?: string
          imported_at?: string | null
          iss_retido?: boolean | null
          lancado_em?: string | null
          lancado_por?: string | null
          municipio_incidencia_codigo?: string | null
          municipio_incidencia_nome?: string | null
          natureza_tributacao?: string | null
          nsu?: number | null
          numero?: string | null
          pedido_compra_centro_custo?: string | null
          pedido_compra_classe?: string | null
          pedido_compra_cond_pagamento?: string | null
          pedido_compra_entidade?: string | null
          pedido_compra_numero?: string | null
          pedido_compra_valor?: number | null
          prestador_cnpj?: string | null
          prestador_cpf?: string | null
          prestador_inscricao_municipal?: string | null
          prestador_municipio_codigo?: string | null
          prestador_municipio_nome?: string | null
          prestador_nome?: string | null
          prestador_uf?: string | null
          raw_json?: Json | null
          raw_xml?: string | null
          serie?: string | null
          situacao?: string | null
          status_lancamento?: string | null
          tipo_documento?: string | null
          tipo_evento?: string | null
          tomador_cnpj?: string | null
          tomador_cpf?: string | null
          tomador_nome?: string | null
          updated_at?: string | null
          valor_cofins?: number | null
          valor_deducoes?: number | null
          valor_desconto_condicionado?: number | null
          valor_desconto_incondicionado?: number | null
          valor_iss?: number | null
          valor_iss_retido?: number | null
          valor_liquido?: number | null
          valor_pis?: number | null
          valor_retencao_csll?: number | null
          valor_retencao_inss?: number | null
          valor_retencao_irrf?: number | null
          valor_servico?: number | null
          valor_total_retencoes?: number | null
        }
        Relationships: []
      }
      compras_pedidos: {
        Row: {
          anexos: Json | null
          aprovado: string | null
          centro_custo: string | null
          classe_rateio: Json | null
          classe_rec_desp: string | null
          cnpj_entidade: string | null
          codigo_cond_pag: string | null
          codigo_empresa_filial: string
          codigo_entidade: string | null
          codigo_usuario: string | null
          comprado: string | null
          created_at: string | null
          data_cadastro: string | null
          data_entrega: string | null
          data_pedido: string | null
          data_validade: string | null
          detalhes_carregados: boolean | null
          detalhes_carregados_em: string | null
          id: string
          itens: Json | null
          nome_cond_pag: string | null
          nome_entidade: string | null
          numero: string
          parcelas: Json | null
          status: string | null
          status_aprovacao: string | null
          synced_at: string | null
          texto: string | null
          texto_historico: string | null
          tipo: string | null
          updated_at: string | null
          valor_desconto: number | null
          valor_frete: number | null
          valor_mercadoria: number | null
          valor_servico: number | null
          valor_total: number | null
        }
        Insert: {
          anexos?: Json | null
          aprovado?: string | null
          centro_custo?: string | null
          classe_rateio?: Json | null
          classe_rec_desp?: string | null
          cnpj_entidade?: string | null
          codigo_cond_pag?: string | null
          codigo_empresa_filial?: string
          codigo_entidade?: string | null
          codigo_usuario?: string | null
          comprado?: string | null
          created_at?: string | null
          data_cadastro?: string | null
          data_entrega?: string | null
          data_pedido?: string | null
          data_validade?: string | null
          detalhes_carregados?: boolean | null
          detalhes_carregados_em?: string | null
          id?: string
          itens?: Json | null
          nome_cond_pag?: string | null
          nome_entidade?: string | null
          numero: string
          parcelas?: Json | null
          status?: string | null
          status_aprovacao?: string | null
          synced_at?: string | null
          texto?: string | null
          texto_historico?: string | null
          tipo?: string | null
          updated_at?: string | null
          valor_desconto?: number | null
          valor_frete?: number | null
          valor_mercadoria?: number | null
          valor_servico?: number | null
          valor_total?: number | null
        }
        Update: {
          anexos?: Json | null
          aprovado?: string | null
          centro_custo?: string | null
          classe_rateio?: Json | null
          classe_rec_desp?: string | null
          cnpj_entidade?: string | null
          codigo_cond_pag?: string | null
          codigo_empresa_filial?: string
          codigo_entidade?: string | null
          codigo_usuario?: string | null
          comprado?: string | null
          created_at?: string | null
          data_cadastro?: string | null
          data_entrega?: string | null
          data_pedido?: string | null
          data_validade?: string | null
          detalhes_carregados?: boolean | null
          detalhes_carregados_em?: string | null
          id?: string
          itens?: Json | null
          nome_cond_pag?: string | null
          nome_entidade?: string | null
          numero?: string
          parcelas?: Json | null
          status?: string | null
          status_aprovacao?: string | null
          synced_at?: string | null
          texto?: string | null
          texto_historico?: string | null
          tipo?: string | null
          updated_at?: string | null
          valor_desconto?: number | null
          valor_frete?: number | null
          valor_mercadoria?: number | null
          valor_servico?: number | null
          valor_total?: number | null
        }
        Relationships: []
      }
      condicoes_pagamento: {
        Row: {
          codigo: string
          dias_entre_parcelas: number | null
          nome: string
          primeiro_vencimento_apos: number | null
          quantidade_parcelas: number | null
          updated_at: string | null
        }
        Insert: {
          codigo: string
          dias_entre_parcelas?: number | null
          nome: string
          primeiro_vencimento_apos?: number | null
          quantidade_parcelas?: number | null
          updated_at?: string | null
        }
        Update: {
          codigo?: string
          dias_entre_parcelas?: number | null
          nome?: string
          primeiro_vencimento_apos?: number | null
          quantidade_parcelas?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      contas_pagar: {
        Row: {
          alternativo1: string | null
          categorias: string | null
          centro_custo: string | null
          chave_docfin: number
          chave_movestq: number | null
          classe_rec_desp: string | null
          cnpj_cpf: string | null
          codigo_empresa_filial: string
          codigo_empresa_filial_movestq: string | null
          codigo_entidade: string | null
          codigo_situacao: string | null
          cond_pagamento: string | null
          data_competencia: string | null
          data_emissao: string | null
          data_entrada: string | null
          data_pagamento: string | null
          data_prorrogacao: string | null
          data_vencimento: string | null
          especie: string | null
          id: string
          modulo_origem: string | null
          nome_cond_pagamento: string | null
          nome_entidade: string | null
          nome_fantasia_entidade: string | null
          nome_situacao: string | null
          nome_tipo_cobranca: string | null
          nome_tipo_pag_rec: string | null
          numero: string | null
          observacao: string | null
          observacao_docfin: string | null
          origem: string | null
          parcial: number
          projecao: string | null
          sequencia: number
          serie: string | null
          synced_at: string | null
          tipo_cobranca: string | null
          tipo_pag_rec: string | null
          valor_bruto: number | null
          valor_cofins_rf: number | null
          valor_csll_rf: number | null
          valor_desconto: number | null
          valor_inss: number | null
          valor_irrf: number | null
          valor_iss: number | null
          valor_juros: number | null
          valor_multa: number | null
          valor_original: number | null
          valor_pago: number | null
          valor_pis_rf: number | null
        }
        Insert: {
          alternativo1?: string | null
          categorias?: string | null
          centro_custo?: string | null
          chave_docfin: number
          chave_movestq?: number | null
          classe_rec_desp?: string | null
          cnpj_cpf?: string | null
          codigo_empresa_filial?: string
          codigo_empresa_filial_movestq?: string | null
          codigo_entidade?: string | null
          codigo_situacao?: string | null
          cond_pagamento?: string | null
          data_competencia?: string | null
          data_emissao?: string | null
          data_entrada?: string | null
          data_pagamento?: string | null
          data_prorrogacao?: string | null
          data_vencimento?: string | null
          especie?: string | null
          id?: string
          modulo_origem?: string | null
          nome_cond_pagamento?: string | null
          nome_entidade?: string | null
          nome_fantasia_entidade?: string | null
          nome_situacao?: string | null
          nome_tipo_cobranca?: string | null
          nome_tipo_pag_rec?: string | null
          numero?: string | null
          observacao?: string | null
          observacao_docfin?: string | null
          origem?: string | null
          parcial?: number
          projecao?: string | null
          sequencia?: number
          serie?: string | null
          synced_at?: string | null
          tipo_cobranca?: string | null
          tipo_pag_rec?: string | null
          valor_bruto?: number | null
          valor_cofins_rf?: number | null
          valor_csll_rf?: number | null
          valor_desconto?: number | null
          valor_inss?: number | null
          valor_irrf?: number | null
          valor_iss?: number | null
          valor_juros?: number | null
          valor_multa?: number | null
          valor_original?: number | null
          valor_pago?: number | null
          valor_pis_rf?: number | null
        }
        Update: {
          alternativo1?: string | null
          categorias?: string | null
          centro_custo?: string | null
          chave_docfin?: number
          chave_movestq?: number | null
          classe_rec_desp?: string | null
          cnpj_cpf?: string | null
          codigo_empresa_filial?: string
          codigo_empresa_filial_movestq?: string | null
          codigo_entidade?: string | null
          codigo_situacao?: string | null
          cond_pagamento?: string | null
          data_competencia?: string | null
          data_emissao?: string | null
          data_entrada?: string | null
          data_pagamento?: string | null
          data_prorrogacao?: string | null
          data_vencimento?: string | null
          especie?: string | null
          id?: string
          modulo_origem?: string | null
          nome_cond_pagamento?: string | null
          nome_entidade?: string | null
          nome_fantasia_entidade?: string | null
          nome_situacao?: string | null
          nome_tipo_cobranca?: string | null
          nome_tipo_pag_rec?: string | null
          numero?: string | null
          observacao?: string | null
          observacao_docfin?: string | null
          origem?: string | null
          parcial?: number
          projecao?: string | null
          sequencia?: number
          serie?: string | null
          synced_at?: string | null
          tipo_cobranca?: string | null
          tipo_pag_rec?: string | null
          valor_bruto?: number | null
          valor_cofins_rf?: number | null
          valor_csll_rf?: number | null
          valor_desconto?: number | null
          valor_inss?: number | null
          valor_irrf?: number | null
          valor_iss?: number | null
          valor_juros?: number | null
          valor_multa?: number | null
          valor_original?: number | null
          valor_pago?: number | null
          valor_pis_rf?: number | null
        }
        Relationships: []
      }
      cost_centers: {
        Row: {
          cost_type: string | null
          created_at: string | null
          department_type: string | null
          description: string | null
          erp_code: string | null
          erp_short_code: string | null
          group_type: string | null
          id: string
          is_active: boolean | null
          name: string
          parent_code: string | null
          updated_at: string | null
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          cost_type?: string | null
          created_at?: string | null
          department_type?: string | null
          description?: string | null
          erp_code?: string | null
          erp_short_code?: string | null
          group_type?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          parent_code?: string | null
          updated_at?: string | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          cost_type?: string | null
          created_at?: string | null
          department_type?: string | null
          description?: string | null
          erp_code?: string | null
          erp_short_code?: string | null
          group_type?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          parent_code?: string | null
          updated_at?: string | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: []
      }
      credit_card_invoices: {
        Row: {
          card_id: string
          created_at: string | null
          due_date: string | null
          id: string
          month: number
          payment_date: string | null
          status: string | null
          total_amount: number | null
          year: number
        }
        Insert: {
          card_id: string
          created_at?: string | null
          due_date?: string | null
          id?: string
          month: number
          payment_date?: string | null
          status?: string | null
          total_amount?: number | null
          year: number
        }
        Update: {
          card_id?: string
          created_at?: string | null
          due_date?: string | null
          id?: string
          month?: number
          payment_date?: string | null
          status?: string | null
          total_amount?: number | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "credit_card_invoices_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_card_transactions: {
        Row: {
          amount: number
          card_id: string
          category: string | null
          cost_center_id: string | null
          created_at: string | null
          description: string
          id: string
          invoice_id: string
          notes: string | null
          transaction_date: string
          transaction_type: string | null
        }
        Insert: {
          amount: number
          card_id: string
          category?: string | null
          cost_center_id?: string | null
          created_at?: string | null
          description: string
          id?: string
          invoice_id: string
          notes?: string | null
          transaction_date: string
          transaction_type?: string | null
        }
        Update: {
          amount?: number
          card_id?: string
          category?: string | null
          cost_center_id?: string | null
          created_at?: string | null
          description?: string
          id?: string
          invoice_id?: string
          notes?: string | null
          transaction_date?: string
          transaction_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_card_transactions_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_transactions_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_card_transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "credit_card_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_cards: {
        Row: {
          bank_name: string
          card_color: string
          created_at: string | null
          due_day: number
          holder_name: string
          id: string
          is_active: boolean | null
          last_four: string
          network: string
        }
        Insert: {
          bank_name: string
          card_color?: string
          created_at?: string | null
          due_day: number
          holder_name: string
          id?: string
          is_active?: boolean | null
          last_four: string
          network: string
        }
        Update: {
          bank_name?: string
          card_color?: string
          created_at?: string | null
          due_day?: number
          holder_name?: string
          id?: string
          is_active?: boolean | null
          last_four?: string
          network?: string
        }
        Relationships: []
      }
      depreciation_history: {
        Row: {
          asset_code: string
          asset_id: string
          calculated_at: string | null
          category_id: string | null
          depreciation_after: number
          depreciation_amount: number
          depreciation_before: number
          gross_value: number
          id: string
          is_fully_depreciated: boolean | null
          monthly_rate: number | null
          months_elapsed: number | null
          net_value_after: number
          period_id: string
          useful_life_months: number | null
        }
        Insert: {
          asset_code: string
          asset_id: string
          calculated_at?: string | null
          category_id?: string | null
          depreciation_after: number
          depreciation_amount: number
          depreciation_before: number
          gross_value: number
          id?: string
          is_fully_depreciated?: boolean | null
          monthly_rate?: number | null
          months_elapsed?: number | null
          net_value_after: number
          period_id: string
          useful_life_months?: number | null
        }
        Update: {
          asset_code?: string
          asset_id?: string
          calculated_at?: string | null
          category_id?: string | null
          depreciation_after?: number
          depreciation_amount?: number
          depreciation_before?: number
          gross_value?: number
          id?: string
          is_fully_depreciated?: boolean | null
          monthly_rate?: number | null
          months_elapsed?: number | null
          net_value_after?: number
          period_id?: string
          useful_life_months?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "depreciation_history_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "fixed_assets_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depreciation_history_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "fixed_assets_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depreciation_history_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "periods"
            referencedColumns: ["id"]
          },
        ]
      }
      docfin_mapping: {
        Row: {
          alvo_document_id: string
          created_at: string
          docfin_key: number
          docfin_number: string | null
          docfin_situation: string | null
          docfin_type: string | null
          id: string
          intercompany_id: string
          updated_at: string
        }
        Insert: {
          alvo_document_id: string
          created_at?: string
          docfin_key: number
          docfin_number?: string | null
          docfin_situation?: string | null
          docfin_type?: string | null
          id?: string
          intercompany_id: string
          updated_at?: string
        }
        Update: {
          alvo_document_id?: string
          created_at?: string
          docfin_key?: number
          docfin_number?: string | null
          docfin_situation?: string | null
          docfin_type?: string | null
          id?: string
          intercompany_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "docfin_mapping_intercompany_id_fkey"
            columns: ["intercompany_id"]
            isOneToOne: false
            referencedRelation: "intercompany"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_transactions: {
        Row: {
          amount: number
          bank_code: string
          created_at: string
          description: string | null
          due_date: string
          entity_name: string | null
          erp_id: string
          id: string
          matched_ofx_fit_id: string | null
          period_id: string
          realized: string
          transaction_type: string
          updated_at: string
        }
        Insert: {
          amount: number
          bank_code?: string
          created_at?: string
          description?: string | null
          due_date: string
          entity_name?: string | null
          erp_id: string
          id?: string
          matched_ofx_fit_id?: string | null
          period_id: string
          realized?: string
          transaction_type?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          bank_code?: string
          created_at?: string
          description?: string | null
          due_date?: string
          entity_name?: string | null
          erp_id?: string
          id?: string
          matched_ofx_fit_id?: string | null
          period_id?: string
          realized?: string
          transaction_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_transactions_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "periods"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_assets_categories: {
        Row: {
          account_asset: string
          account_depreciation: string | null
          code: string
          created_at: string
          default_monthly_rate: number | null
          default_useful_life_months: number | null
          depreciable: boolean
          id: string
          label: string
          sort_order: number | null
        }
        Insert: {
          account_asset: string
          account_depreciation?: string | null
          code: string
          created_at?: string
          default_monthly_rate?: number | null
          default_useful_life_months?: number | null
          depreciable?: boolean
          id?: string
          label: string
          sort_order?: number | null
        }
        Update: {
          account_asset?: string
          account_depreciation?: string | null
          code?: string
          created_at?: string
          default_monthly_rate?: number | null
          default_useful_life_months?: number | null
          depreciable?: boolean
          id?: string
          label?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      fixed_assets_items: {
        Row: {
          accumulated_depreciation: number
          acquisition_date: string | null
          asset_code: string
          asset_description: string
          asset_tag: string | null
          audit_source_id: string | null
          brand_model: string | null
          category: string
          category_id: string | null
          created_at: string
          gross_value: number
          id: string
          last_audit_date: string | null
          location: string
          monthly_depreciation_rate: number | null
          net_value: number | null
          notes: string | null
          period_id: string
          responsible_department: string | null
          responsible_name: string | null
          responsible_user: string | null
          serial_number: string | null
          source: string
          status: string
          updated_at: string
          useful_life_months: number | null
        }
        Insert: {
          accumulated_depreciation?: number
          acquisition_date?: string | null
          asset_code: string
          asset_description?: string
          asset_tag?: string | null
          audit_source_id?: string | null
          brand_model?: string | null
          category?: string
          category_id?: string | null
          created_at?: string
          gross_value?: number
          id?: string
          last_audit_date?: string | null
          location?: string
          monthly_depreciation_rate?: number | null
          net_value?: number | null
          notes?: string | null
          period_id: string
          responsible_department?: string | null
          responsible_name?: string | null
          responsible_user?: string | null
          serial_number?: string | null
          source?: string
          status?: string
          updated_at?: string
          useful_life_months?: number | null
        }
        Update: {
          accumulated_depreciation?: number
          acquisition_date?: string | null
          asset_code?: string
          asset_description?: string
          asset_tag?: string | null
          audit_source_id?: string | null
          brand_model?: string | null
          category?: string
          category_id?: string | null
          created_at?: string
          gross_value?: number
          id?: string
          last_audit_date?: string | null
          location?: string
          monthly_depreciation_rate?: number | null
          net_value?: number | null
          notes?: string | null
          period_id?: string
          responsible_department?: string | null
          responsible_name?: string | null
          responsible_user?: string | null
          serial_number?: string | null
          source?: string
          status?: string
          updated_at?: string
          useful_life_months?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fixed_assets_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "fixed_assets_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_items_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "periods"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_assets_reconciliation: {
        Row: {
          account_asset: string
          account_depreciation: string | null
          accounting_balance_asset: number | null
          accounting_balance_depreciation: number | null
          accounting_net: number | null
          accumulated_depreciation: number
          category_id: string
          created_at: string
          difference: number | null
          gross_value: number
          id: string
          justification: string | null
          net_value: number | null
          period_id: string
          status: string
          updated_at: string
        }
        Insert: {
          account_asset: string
          account_depreciation?: string | null
          accounting_balance_asset?: number | null
          accounting_balance_depreciation?: number | null
          accounting_net?: number | null
          accumulated_depreciation?: number
          category_id: string
          created_at?: string
          difference?: number | null
          gross_value?: number
          id?: string
          justification?: string | null
          net_value?: number | null
          period_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          account_asset?: string
          account_depreciation?: string | null
          accounting_balance_asset?: number | null
          accounting_balance_depreciation?: number | null
          accounting_net?: number | null
          accumulated_depreciation?: number
          category_id?: string
          created_at?: string
          difference?: number | null
          gross_value?: number
          id?: string
          justification?: string | null
          net_value?: number | null
          period_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixed_assets_reconciliation_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "fixed_assets_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_reconciliation_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "periods"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_assets_summary: {
        Row: {
          accounting_balance: number
          accumulated_depreciation: number
          api_last_sync: string | null
          api_status: string
          created_at: string
          difference: number | null
          gross_asset_value: number
          id: string
          justification: string | null
          net_asset_value: number | null
          period_id: string
          responsible_user: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          accounting_balance?: number
          accumulated_depreciation?: number
          api_last_sync?: string | null
          api_status?: string
          created_at?: string
          difference?: number | null
          gross_asset_value?: number
          id?: string
          justification?: string | null
          net_asset_value?: number | null
          period_id: string
          responsible_user?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          accounting_balance?: number
          accumulated_depreciation?: number
          api_last_sync?: string | null
          api_status?: string
          created_at?: string
          difference?: number | null
          gross_asset_value?: number
          id?: string
          justification?: string | null
          net_asset_value?: number | null
          period_id?: string
          responsible_user?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixed_assets_summary_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: true
            referencedRelation: "periods"
            referencedColumns: ["id"]
          },
        ]
      }
      intercompany: {
        Row: {
          alvo_country_code: string | null
          alvo_document_id: string | null
          alvo_entity_code: string | null
          amount_brl: number | null
          cfop: string | null
          competence_date: string | null
          country: string
          created_at: string
          currency: string
          description: string
          direction: string
          doc_type: string | null
          docfin_key: number | null
          document_reference: string | null
          due_date: string | null
          exchange_rate: number
          freight_value: number | null
          fx_variation: number | null
          id: string
          invoice_reference: string | null
          issue_date: string | null
          last_synced_at: string | null
          nf_model: string | null
          nf_number: string | null
          nf_series: string | null
          notes: string | null
          original_amount: number
          payment_additions: number | null
          payment_amount_brl: number | null
          payment_date: string | null
          payment_deductions: number | null
          payment_discount: number | null
          payment_exchange_rate: number | null
          payment_status: string
          payment_updated_at: string | null
          period_id: string
          product_value: number | null
          related_company: string
          responsible_user: string | null
          service_value: number | null
          source: string
          status: string
          tax_total: number | null
          transaction_type: string
          updated_at: string
        }
        Insert: {
          alvo_country_code?: string | null
          alvo_document_id?: string | null
          alvo_entity_code?: string | null
          amount_brl?: number | null
          cfop?: string | null
          competence_date?: string | null
          country?: string
          created_at?: string
          currency?: string
          description?: string
          direction?: string
          doc_type?: string | null
          docfin_key?: number | null
          document_reference?: string | null
          due_date?: string | null
          exchange_rate?: number
          freight_value?: number | null
          fx_variation?: number | null
          id?: string
          invoice_reference?: string | null
          issue_date?: string | null
          last_synced_at?: string | null
          nf_model?: string | null
          nf_number?: string | null
          nf_series?: string | null
          notes?: string | null
          original_amount?: number
          payment_additions?: number | null
          payment_amount_brl?: number | null
          payment_date?: string | null
          payment_deductions?: number | null
          payment_discount?: number | null
          payment_exchange_rate?: number | null
          payment_status?: string
          payment_updated_at?: string | null
          period_id: string
          product_value?: number | null
          related_company: string
          responsible_user?: string | null
          service_value?: number | null
          source?: string
          status?: string
          tax_total?: number | null
          transaction_type?: string
          updated_at?: string
        }
        Update: {
          alvo_country_code?: string | null
          alvo_document_id?: string | null
          alvo_entity_code?: string | null
          amount_brl?: number | null
          cfop?: string | null
          competence_date?: string | null
          country?: string
          created_at?: string
          currency?: string
          description?: string
          direction?: string
          doc_type?: string | null
          docfin_key?: number | null
          document_reference?: string | null
          due_date?: string | null
          exchange_rate?: number
          freight_value?: number | null
          fx_variation?: number | null
          id?: string
          invoice_reference?: string | null
          issue_date?: string | null
          last_synced_at?: string | null
          nf_model?: string | null
          nf_number?: string | null
          nf_series?: string | null
          notes?: string | null
          original_amount?: number
          payment_additions?: number | null
          payment_amount_brl?: number | null
          payment_date?: string | null
          payment_deductions?: number | null
          payment_discount?: number | null
          payment_exchange_rate?: number | null
          payment_status?: string
          payment_updated_at?: string | null
          period_id?: string
          product_value?: number | null
          related_company?: string
          responsible_user?: string | null
          service_value?: number | null
          source?: string
          status?: string
          tax_total?: number | null
          transaction_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "intercompany_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "periods"
            referencedColumns: ["id"]
          },
        ]
      }
      intercompany_alvo_docs: {
        Row: {
          alvo_document_id: string
          amount_brl: number | null
          cfop: string | null
          competence_date: string | null
          country_code: string | null
          created_at: string
          currency: string
          dados_adicionais: string | null
          doc_type: string
          docfin_key: number | null
          document_origin: string | null
          entity_code: string
          entity_name: string | null
          exchange_rate: number
          freight_value: number | null
          id: string
          intercompany_id: string | null
          invoice_reference: string | null
          is_cancelled: boolean
          issue_date: string | null
          nf_model: string | null
          nf_number: string | null
          nf_series: string | null
          original_amount: number
          product_value: number | null
          raw_json: Json | null
          raw_json_new: Json | null
          service_value: number | null
          sync_error: string | null
          sync_status: string
          tax_cofins: number | null
          tax_csll: number | null
          tax_iss: number | null
          tax_pis: number | null
          updated_at: string
        }
        Insert: {
          alvo_document_id: string
          amount_brl?: number | null
          cfop?: string | null
          competence_date?: string | null
          country_code?: string | null
          created_at?: string
          currency?: string
          dados_adicionais?: string | null
          doc_type: string
          docfin_key?: number | null
          document_origin?: string | null
          entity_code: string
          entity_name?: string | null
          exchange_rate?: number
          freight_value?: number | null
          id?: string
          intercompany_id?: string | null
          invoice_reference?: string | null
          is_cancelled?: boolean
          issue_date?: string | null
          nf_model?: string | null
          nf_number?: string | null
          nf_series?: string | null
          original_amount?: number
          product_value?: number | null
          raw_json?: Json | null
          raw_json_new?: Json | null
          service_value?: number | null
          sync_error?: string | null
          sync_status?: string
          tax_cofins?: number | null
          tax_csll?: number | null
          tax_iss?: number | null
          tax_pis?: number | null
          updated_at?: string
        }
        Update: {
          alvo_document_id?: string
          amount_brl?: number | null
          cfop?: string | null
          competence_date?: string | null
          country_code?: string | null
          created_at?: string
          currency?: string
          dados_adicionais?: string | null
          doc_type?: string
          docfin_key?: number | null
          document_origin?: string | null
          entity_code?: string
          entity_name?: string | null
          exchange_rate?: number
          freight_value?: number | null
          id?: string
          intercompany_id?: string | null
          invoice_reference?: string | null
          is_cancelled?: boolean
          issue_date?: string | null
          nf_model?: string | null
          nf_number?: string | null
          nf_series?: string | null
          original_amount?: number
          product_value?: number | null
          raw_json?: Json | null
          raw_json_new?: Json | null
          service_value?: number | null
          sync_error?: string | null
          sync_status?: string
          tax_cofins?: number | null
          tax_csll?: number | null
          tax_iss?: number | null
          tax_pis?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "intercompany_alvo_docs_intercompany_id_fkey"
            columns: ["intercompany_id"]
            isOneToOne: false
            referencedRelation: "intercompany"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          category: string
          created_at: string
          id: string
          item_code: string
          item_description: string
          location: string
          notes: string | null
          period_id: string
          physical_quantity: number
          responsible_user: string | null
          total_cost: number | null
          unit_cost: number
          unit_of_measure: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          item_code: string
          item_description: string
          location?: string
          notes?: string | null
          period_id: string
          physical_quantity?: number
          responsible_user?: string | null
          total_cost?: number | null
          unit_cost?: number
          unit_of_measure?: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          item_code?: string
          item_description?: string
          location?: string
          notes?: string | null
          period_id?: string
          physical_quantity?: number
          responsible_user?: string | null
          total_cost?: number | null
          unit_cost?: number
          unit_of_measure?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "periods"
            referencedColumns: ["id"]
          },
        ]
      }
      nf_entrada: {
        Row: {
          chave_acesso_nfe: string | null
          class_rec_desp_codigo: string | null
          class_rec_desp_nome: string | null
          cost_center_id: string | null
          created_at: string | null
          data_emissao: string | null
          data_entrada: string | null
          data_movimento: string | null
          erp_chave: number
          especie: string | null
          fornecedor_cnpj: string | null
          fornecedor_codigo: string | null
          fornecedor_nome: string | null
          id: string
          numero: string | null
          observacao: string | null
          origem: string
          raw_json: Json | null
          serie: string | null
          tipo_lancamento: string
          updated_at: string | null
          valor_documento: number | null
          valor_liquido: number | null
          valor_mercadoria: number | null
        }
        Insert: {
          chave_acesso_nfe?: string | null
          class_rec_desp_codigo?: string | null
          class_rec_desp_nome?: string | null
          cost_center_id?: string | null
          created_at?: string | null
          data_emissao?: string | null
          data_entrada?: string | null
          data_movimento?: string | null
          erp_chave: number
          especie?: string | null
          fornecedor_cnpj?: string | null
          fornecedor_codigo?: string | null
          fornecedor_nome?: string | null
          id?: string
          numero?: string | null
          observacao?: string | null
          origem?: string
          raw_json?: Json | null
          serie?: string | null
          tipo_lancamento: string
          updated_at?: string | null
          valor_documento?: number | null
          valor_liquido?: number | null
          valor_mercadoria?: number | null
        }
        Update: {
          chave_acesso_nfe?: string | null
          class_rec_desp_codigo?: string | null
          class_rec_desp_nome?: string | null
          cost_center_id?: string | null
          created_at?: string | null
          data_emissao?: string | null
          data_entrada?: string | null
          data_movimento?: string | null
          erp_chave?: number
          especie?: string | null
          fornecedor_cnpj?: string | null
          fornecedor_codigo?: string | null
          fornecedor_nome?: string | null
          id?: string
          numero?: string | null
          observacao?: string | null
          origem?: string
          raw_json?: Json | null
          serie?: string | null
          tipo_lancamento?: string
          updated_at?: string | null
          valor_documento?: number | null
          valor_liquido?: number | null
          valor_mercadoria?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "nf_entrada_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      nf_entrada_rateio: {
        Row: {
          centro_percentual: number | null
          centro_valor: number | null
          class_rec_desp_codigo: string | null
          class_rec_desp_nome: string | null
          classe_percentual: number | null
          classe_valor: number | null
          cost_center_erp_code: string | null
          cost_center_id: string | null
          created_at: string | null
          erp_chave: number
          id: string
          nf_entrada_id: string | null
          sequencia: number | null
        }
        Insert: {
          centro_percentual?: number | null
          centro_valor?: number | null
          class_rec_desp_codigo?: string | null
          class_rec_desp_nome?: string | null
          classe_percentual?: number | null
          classe_valor?: number | null
          cost_center_erp_code?: string | null
          cost_center_id?: string | null
          created_at?: string | null
          erp_chave: number
          id?: string
          nf_entrada_id?: string | null
          sequencia?: number | null
        }
        Update: {
          centro_percentual?: number | null
          centro_valor?: number | null
          class_rec_desp_codigo?: string | null
          class_rec_desp_nome?: string | null
          classe_percentual?: number | null
          classe_valor?: number | null
          cost_center_erp_code?: string | null
          cost_center_id?: string | null
          created_at?: string | null
          erp_chave?: number
          id?: string
          nf_entrada_id?: string | null
          sequencia?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "nf_entrada_rateio_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nf_entrada_rateio_nf_entrada_id_fkey"
            columns: ["nf_entrada_id"]
            isOneToOne: false
            referencedRelation: "nf_entrada"
            referencedColumns: ["id"]
          },
        ]
      }
      payables: {
        Row: {
          amount_brl: number | null
          category: string
          created_at: string
          currency: string
          document_number: string
          due_date: string
          exchange_rate: number
          id: string
          issue_date: string
          notes: string | null
          original_amount: number
          payment_amount: number
          payment_date: string | null
          period_id: string
          remaining_balance: number | null
          responsible_user: string | null
          status: string
          supplier_name: string
          updated_at: string
        }
        Insert: {
          amount_brl?: number | null
          category?: string
          created_at?: string
          currency?: string
          document_number: string
          due_date: string
          exchange_rate?: number
          id?: string
          issue_date: string
          notes?: string | null
          original_amount?: number
          payment_amount?: number
          payment_date?: string | null
          period_id: string
          remaining_balance?: number | null
          responsible_user?: string | null
          status?: string
          supplier_name: string
          updated_at?: string
        }
        Update: {
          amount_brl?: number | null
          category?: string
          created_at?: string
          currency?: string
          document_number?: string
          due_date?: string
          exchange_rate?: number
          id?: string
          issue_date?: string
          notes?: string | null
          original_amount?: number
          payment_amount?: number
          payment_date?: string | null
          period_id?: string
          remaining_balance?: number | null
          responsible_user?: string | null
          status?: string
          supplier_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payables_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "periods"
            referencedColumns: ["id"]
          },
        ]
      }
      periods: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          id: string
          month: number
          status: string
          year: number
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          month: number
          status?: string
          year: number
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          month?: number
          status?: string
          year?: number
        }
        Relationships: []
      }
      produtos_cache: {
        Row: {
          codigo: string
          codigo_clas_fiscal: string | null
          codigo_tipo_prod_fisc: string | null
          nome: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          codigo: string
          codigo_clas_fiscal?: string | null
          codigo_tipo_prod_fisc?: string | null
          nome: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          codigo?: string
          codigo_clas_fiscal?: string | null
          codigo_tipo_prod_fisc?: string | null
          nome?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean | null
          is_admin: boolean | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean | null
          is_admin?: boolean | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean | null
          is_admin?: boolean | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      projeto_pedido_auditoria: {
        Row: {
          budget_origem_id: string | null
          campo: string
          created_at: string | null
          desvio_percentual: number | null
          desvio_valor: number | null
          id: string
          projeto_id: string | null
          requisicao_id: string | null
          usuario: string | null
          valor_actual: string | null
          valor_budget: string | null
        }
        Insert: {
          budget_origem_id?: string | null
          campo: string
          created_at?: string | null
          desvio_percentual?: number | null
          desvio_valor?: number | null
          id?: string
          projeto_id?: string | null
          requisicao_id?: string | null
          usuario?: string | null
          valor_actual?: string | null
          valor_budget?: string | null
        }
        Update: {
          budget_origem_id?: string | null
          campo?: string
          created_at?: string | null
          desvio_percentual?: number | null
          desvio_valor?: number | null
          id?: string
          projeto_id?: string | null
          requisicao_id?: string | null
          usuario?: string | null
          valor_actual?: string | null
          valor_budget?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projeto_pedido_auditoria_budget_origem_id_fkey"
            columns: ["budget_origem_id"]
            isOneToOne: false
            referencedRelation: "projeto_requisicoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projeto_pedido_auditoria_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: false
            referencedRelation: "projetos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projeto_pedido_auditoria_requisicao_id_fkey"
            columns: ["requisicao_id"]
            isOneToOne: false
            referencedRelation: "projeto_requisicoes"
            referencedColumns: ["id"]
          },
        ]
      }
      projeto_requisicoes: {
        Row: {
          bloqueado: boolean
          budget_origem_id: string | null
          classe_rateio: Json | null
          cond_pagamento_codigo: string | null
          cond_pagamento_nome: string | null
          created_at: string | null
          criado_por: string | null
          descricao: string
          enviado_alvo_em: string | null
          enviado_alvo_por: string | null
          enviado_em: string | null
          erro_envio: string | null
          fase: string
          fornecedor_cnpj: string | null
          fornecedor_codigo: string | null
          fornecedor_nome: string | null
          id: string
          itens: Json | null
          numero_pedido_alvo: string | null
          projeto_id: string
          sequencia: number
          status: string
          updated_at: string | null
          valor_total: number
        }
        Insert: {
          bloqueado?: boolean
          budget_origem_id?: string | null
          classe_rateio?: Json | null
          cond_pagamento_codigo?: string | null
          cond_pagamento_nome?: string | null
          created_at?: string | null
          criado_por?: string | null
          descricao: string
          enviado_alvo_em?: string | null
          enviado_alvo_por?: string | null
          enviado_em?: string | null
          erro_envio?: string | null
          fase?: string
          fornecedor_cnpj?: string | null
          fornecedor_codigo?: string | null
          fornecedor_nome?: string | null
          id?: string
          itens?: Json | null
          numero_pedido_alvo?: string | null
          projeto_id: string
          sequencia?: number
          status?: string
          updated_at?: string | null
          valor_total?: number
        }
        Update: {
          bloqueado?: boolean
          budget_origem_id?: string | null
          classe_rateio?: Json | null
          cond_pagamento_codigo?: string | null
          cond_pagamento_nome?: string | null
          created_at?: string | null
          criado_por?: string | null
          descricao?: string
          enviado_alvo_em?: string | null
          enviado_alvo_por?: string | null
          enviado_em?: string | null
          erro_envio?: string | null
          fase?: string
          fornecedor_cnpj?: string | null
          fornecedor_codigo?: string | null
          fornecedor_nome?: string | null
          id?: string
          itens?: Json | null
          numero_pedido_alvo?: string | null
          projeto_id?: string
          sequencia?: number
          status?: string
          updated_at?: string | null
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "projeto_requisicoes_budget_origem_id_fkey"
            columns: ["budget_origem_id"]
            isOneToOne: false
            referencedRelation: "projeto_requisicoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projeto_requisicoes_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: false
            referencedRelation: "projetos"
            referencedColumns: ["id"]
          },
        ]
      }
      projetos: {
        Row: {
          budget_aprovado_em: string | null
          budget_aprovado_por: string | null
          created_at: string | null
          criado_por: string | null
          data_fim: string | null
          data_inicio: string | null
          descricao: string | null
          fase_atual: string
          id: string
          nome: string
          orcamento: number
          responsavel: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          budget_aprovado_em?: string | null
          budget_aprovado_por?: string | null
          created_at?: string | null
          criado_por?: string | null
          data_fim?: string | null
          data_inicio?: string | null
          descricao?: string | null
          fase_atual?: string
          id?: string
          nome: string
          orcamento?: number
          responsavel?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          budget_aprovado_em?: string | null
          budget_aprovado_por?: string | null
          created_at?: string | null
          criado_por?: string | null
          data_fim?: string | null
          data_inicio?: string | null
          descricao?: string | null
          fase_atual?: string
          id?: string
          nome?: string
          orcamento?: number
          responsavel?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      receivables: {
        Row: {
          amount_brl: number | null
          created_at: string
          currency: string
          customer_name: string
          document_number: string
          due_date: string
          exchange_rate: number
          id: string
          issue_date: string
          market: string
          notes: string | null
          original_amount: number
          period_id: string
          receipt_amount: number
          receipt_date: string | null
          remaining_balance: number | null
          responsible_user: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_brl?: number | null
          created_at?: string
          currency?: string
          customer_name: string
          document_number: string
          due_date: string
          exchange_rate?: number
          id?: string
          issue_date: string
          market?: string
          notes?: string | null
          original_amount?: number
          period_id: string
          receipt_amount?: number
          receipt_date?: string | null
          remaining_balance?: number | null
          responsible_user?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_brl?: number | null
          created_at?: string
          currency?: string
          customer_name?: string
          document_number?: string
          due_date?: string
          exchange_rate?: number
          id?: string
          issue_date?: string
          market?: string
          notes?: string | null
          original_amount?: number
          period_id?: string
          receipt_amount?: number
          receipt_date?: string | null
          remaining_balance?: number | null
          responsible_user?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "receivables_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "periods"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_summary: {
        Row: {
          accounting_account: string
          accounting_balance: number
          closed_at: string | null
          closed_by: string | null
          created_at: string
          difference: number | null
          id: string
          justification: string | null
          management_balance: number
          module_name: string
          period_id: string
          responsible_user: string | null
          status: string
          updated_at: string
        }
        Insert: {
          accounting_account: string
          accounting_balance?: number
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          difference?: number | null
          id?: string
          justification?: string | null
          management_balance?: number
          module_name: string
          period_id: string
          responsible_user?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          accounting_account?: string
          accounting_balance?: number
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          difference?: number | null
          id?: string
          justification?: string | null
          management_balance?: number
          module_name?: string
          period_id?: string
          responsible_user?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_summary_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "periods"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_excluded_cnpj: {
        Row: {
          cnpj: string
          created_at: string | null
          id: string
          motivo: string | null
          razao_social: string | null
        }
        Insert: {
          cnpj: string
          created_at?: string | null
          id?: string
          motivo?: string | null
          razao_social?: string | null
        }
        Update: {
          cnpj?: string
          created_at?: string | null
          id?: string
          motivo?: string | null
          razao_social?: string | null
        }
        Relationships: []
      }
      sales_invoices: {
        Row: {
          chave_acesso: string | null
          cnpj_destinatario: string | null
          codigo_entidade: string | null
          codigo_usuario: string | null
          created_at: string | null
          data_emissao: string
          data_transmissao: string | null
          id: string
          numero_nf: string
          numero_protocolo: string | null
          periodo: string
          razao_social: string | null
          serie: string | null
          status: string | null
          updated_at: string | null
          valor_brl: number | null
        }
        Insert: {
          chave_acesso?: string | null
          cnpj_destinatario?: string | null
          codigo_entidade?: string | null
          codigo_usuario?: string | null
          created_at?: string | null
          data_emissao: string
          data_transmissao?: string | null
          id?: string
          numero_nf: string
          numero_protocolo?: string | null
          periodo: string
          razao_social?: string | null
          serie?: string | null
          status?: string | null
          updated_at?: string | null
          valor_brl?: number | null
        }
        Update: {
          chave_acesso?: string | null
          cnpj_destinatario?: string | null
          codigo_entidade?: string | null
          codigo_usuario?: string | null
          created_at?: string | null
          data_emissao?: string
          data_transmissao?: string | null
          id?: string
          numero_nf?: string
          numero_protocolo?: string | null
          periodo?: string
          razao_social?: string | null
          serie?: string | null
          status?: string | null
          updated_at?: string | null
          valor_brl?: number | null
        }
        Relationships: []
      }
      stock_adjustments: {
        Row: {
          ajustado_por: string
          count_item_id: string
          created_at: string
          data_referencia: string
          id: string
          motivo: string
          product_id: string
          quantidade_anterior: number
          quantidade_nova: number
          valor_total_anterior: number | null
          valor_total_novo: number | null
        }
        Insert: {
          ajustado_por: string
          count_item_id: string
          created_at?: string
          data_referencia: string
          id?: string
          motivo?: string
          product_id: string
          quantidade_anterior: number
          quantidade_nova: number
          valor_total_anterior?: number | null
          valor_total_novo?: number | null
        }
        Update: {
          ajustado_por?: string
          count_item_id?: string
          created_at?: string
          data_referencia?: string
          id?: string
          motivo?: string
          product_id?: string
          quantidade_anterior?: number
          quantidade_nova?: number
          valor_total_anterior?: number | null
          valor_total_novo?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustments_count_item_id_fkey"
            columns: ["count_item_id"]
            isOneToOne: false
            referencedRelation: "stock_count_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "stock_products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_balance: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          data_referencia: string
          fonte: string
          id: string
          periodo: string
          product_id: string
          quantidade: number
          status: string
          updated_at: string
          valor_medio_unitario: number | null
          valor_total_brl: number | null
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          data_referencia: string
          fonte?: string
          id?: string
          periodo: string
          product_id: string
          quantidade?: number
          status?: string
          updated_at?: string
          valor_medio_unitario?: number | null
          valor_total_brl?: number | null
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          data_referencia?: string
          fonte?: string
          id?: string
          periodo?: string
          product_id?: string
          quantidade?: number
          status?: string
          updated_at?: string
          valor_medio_unitario?: number | null
          valor_total_brl?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_balance_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "stock_products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_count_items: {
        Row: {
          aprovado_em: string | null
          aprovado_por: string | null
          codigo_enviado: string
          count_id: string
          created_at: string
          diferenca: number
          id: string
          product_id: string
          quantidade_contagem: number
          quantidade_sistema: number
          status: string
          valor_total_contagem: number | null
        }
        Insert: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          codigo_enviado: string
          count_id: string
          created_at?: string
          diferenca: number
          id?: string
          product_id: string
          quantidade_contagem: number
          quantidade_sistema: number
          status?: string
          valor_total_contagem?: number | null
        }
        Update: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          codigo_enviado?: string
          count_id?: string
          created_at?: string
          diferenca?: number
          id?: string
          product_id?: string
          quantidade_contagem?: number
          quantidade_sistema?: number
          status?: string
          valor_total_contagem?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_count_items_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "stock_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "stock_products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_counts: {
        Row: {
          created_at: string
          data_referencia: string
          descricao: string
          id: string
          itens_aprovados: number
          itens_divergentes: number
          status: string
          tipo_chave: string
          total_itens: number
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          data_referencia: string
          descricao: string
          id?: string
          itens_aprovados?: number
          itens_divergentes?: number
          status?: string
          tipo_chave: string
          total_itens?: number
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          data_referencia?: string
          descricao?: string
          id?: string
          itens_aprovados?: number
          itens_divergentes?: number
          status?: string
          tipo_chave?: string
          total_itens?: number
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      stock_products: {
        Row: {
          ativo: boolean
          codigo_alternativo: string | null
          codigo_produto: string
          codigo_reduzido: string | null
          created_at: string
          familia_codigo: string | null
          id: string
          nome_produto: string
          tipo_produto: string | null
          unidade_medida: string | null
          updated_at: string
          variacao: string | null
        }
        Insert: {
          ativo?: boolean
          codigo_alternativo?: string | null
          codigo_produto: string
          codigo_reduzido?: string | null
          created_at?: string
          familia_codigo?: string | null
          id?: string
          nome_produto: string
          tipo_produto?: string | null
          unidade_medida?: string | null
          updated_at?: string
          variacao?: string | null
        }
        Update: {
          ativo?: boolean
          codigo_alternativo?: string | null
          codigo_produto?: string
          codigo_reduzido?: string | null
          created_at?: string
          familia_codigo?: string | null
          id?: string
          nome_produto?: string
          tipo_produto?: string | null
          unidade_medida?: string | null
          updated_at?: string
          variacao?: string | null
        }
        Relationships: []
      }
      sync_jobs: {
        Row: {
          ativo: boolean | null
          config: Json | null
          created_at: string | null
          descricao: string | null
          dia_semana: number | null
          endpoint_tipo: string
          frequencia: string
          horario_preferido: string | null
          id: string
          nome: string
          registros_ultima_sync: number | null
          ultima_execucao: string | null
          ultimo_erro: string | null
          ultimo_status: string | null
          updated_at: string | null
        }
        Insert: {
          ativo?: boolean | null
          config?: Json | null
          created_at?: string | null
          descricao?: string | null
          dia_semana?: number | null
          endpoint_tipo?: string
          frequencia?: string
          horario_preferido?: string | null
          id?: string
          nome: string
          registros_ultima_sync?: number | null
          ultima_execucao?: string | null
          ultimo_erro?: string | null
          ultimo_status?: string | null
          updated_at?: string | null
        }
        Update: {
          ativo?: boolean | null
          config?: Json | null
          created_at?: string | null
          descricao?: string | null
          dia_semana?: number | null
          endpoint_tipo?: string
          frequencia?: string
          horario_preferido?: string | null
          id?: string
          nome?: string
          registros_ultima_sync?: number | null
          ultima_execucao?: string | null
          ultimo_erro?: string | null
          ultimo_status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      sync_log: {
        Row: {
          created_at: string | null
          details: Json | null
          error_message: string | null
          finished_at: string | null
          id: string
          records_errors: number | null
          records_processed: number | null
          started_at: string
          status: string
          sync_job_id: string | null
          sync_nome: string
        }
        Insert: {
          created_at?: string | null
          details?: Json | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          records_errors?: number | null
          records_processed?: number | null
          started_at?: string
          status?: string
          sync_job_id?: string | null
          sync_nome: string
        }
        Update: {
          created_at?: string | null
          details?: Json | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          records_errors?: number | null
          records_processed?: number | null
          started_at?: string
          status?: string
          sync_job_id?: string | null
          sync_nome?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_log_sync_job_id_fkey"
            columns: ["sync_job_id"]
            isOneToOne: false
            referencedRelation: "sync_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_queue: {
        Row: {
          api_params: Json
          created_at: string
          doc_number: string
          doc_type: string
          error_message: string | null
          id: string
          processed_at: string | null
          result_summary: string | null
          status: string
          sync_batch_id: string
        }
        Insert: {
          api_params: Json
          created_at?: string
          doc_number: string
          doc_type: string
          error_message?: string | null
          id?: string
          processed_at?: string | null
          result_summary?: string | null
          status?: string
          sync_batch_id: string
        }
        Update: {
          api_params?: Json
          created_at?: string
          doc_number?: string
          doc_type?: string
          error_message?: string | null
          id?: string
          processed_at?: string | null
          result_summary?: string | null
          status?: string
          sync_batch_id?: string
        }
        Relationships: []
      }
      tax_installment_payments: {
        Row: {
          amount_paid: number
          created_at: string
          darf_number: string | null
          due_date: string
          id: string
          installment_number: number
          interest_amount: number
          notes: string | null
          payment_date: string | null
          penalty_amount: number
          plan_id: string
          principal_amount: number
          status: string
          total_amount: number | null
          updated_at: string
        }
        Insert: {
          amount_paid?: number
          created_at?: string
          darf_number?: string | null
          due_date: string
          id?: string
          installment_number?: number
          interest_amount?: number
          notes?: string | null
          payment_date?: string | null
          penalty_amount?: number
          plan_id: string
          principal_amount?: number
          status?: string
          total_amount?: number | null
          updated_at?: string
        }
        Update: {
          amount_paid?: number
          created_at?: string
          darf_number?: string | null
          due_date?: string
          id?: string
          installment_number?: number
          interest_amount?: number
          notes?: string | null
          payment_date?: string | null
          penalty_amount?: number
          plan_id?: string
          principal_amount?: number
          status?: string
          total_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_installment_payments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "tax_installments_plan"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_installments_plan: {
        Row: {
          created_at: string
          current_installment_amount: number
          id: string
          interest_amount: number
          next_due_date: string | null
          notes: string | null
          original_debt: number
          outstanding_balance_long_term: number
          outstanding_balance_short_term: number
          outstanding_balance_total: number
          paid_installments: number
          penalty_amount: number
          period_id: string
          process_number: string | null
          program_name: string
          responsible_user: string | null
          start_date: string
          status: string
          tax_type: string
          total_consolidated: number | null
          total_installments: number
          update_index: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_installment_amount?: number
          id?: string
          interest_amount?: number
          next_due_date?: string | null
          notes?: string | null
          original_debt?: number
          outstanding_balance_long_term?: number
          outstanding_balance_short_term?: number
          outstanding_balance_total?: number
          paid_installments?: number
          penalty_amount?: number
          period_id: string
          process_number?: string | null
          program_name?: string
          responsible_user?: string | null
          start_date?: string
          status?: string
          tax_type?: string
          total_consolidated?: number | null
          total_installments?: number
          update_index?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_installment_amount?: number
          id?: string
          interest_amount?: number
          next_due_date?: string | null
          notes?: string | null
          original_debt?: number
          outstanding_balance_long_term?: number
          outstanding_balance_short_term?: number
          outstanding_balance_total?: number
          paid_installments?: number
          penalty_amount?: number
          period_id?: string
          process_number?: string | null
          program_name?: string
          responsible_user?: string | null
          start_date?: string
          status?: string
          tax_type?: string
          total_consolidated?: number | null
          total_installments?: number
          update_index?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_installments_plan_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "periods"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permissions: {
        Row: {
          allowed: boolean | null
          created_at: string | null
          id: string
          menu_key: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          allowed?: boolean | null
          created_at?: string | null
          id?: string
          menu_key: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          allowed?: boolean | null
          created_at?: string | null
          id?: string
          menu_key?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      calculate_monthly_depreciation: {
        Args: { p_period_id: string }
        Returns: number
      }
      find_or_create_period: {
        Args: { p_competence_date: string }
        Returns: string
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      soft_delete_credit_card: {
        Args: { p_card_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
