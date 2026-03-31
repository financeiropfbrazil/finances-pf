import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-audit-api-key, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface AuditAsset {
  audit_source_id: string;
  asset_code: string;
  asset_description?: string;
  category?: string;
  asset_tag?: string;
  location?: string;
  responsible_name?: string;
  responsible_department?: string;
  serial_number?: string;
  brand_model?: string;
  acquisition_date?: string;
  gross_value?: number;
  useful_life_months?: number;
  monthly_depreciation_rate?: number;
  status?: string;
  last_audit_date?: string;
  notes?: string;
}

interface AuditPayload {
  assets: AuditAsset[];
  period: string; // "2026-03"
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Validate API key
  const auditApiKey = Deno.env.get("AUDIT_API_KEY");
  const providedKey = req.headers.get("x-audit-api-key");

  if (!auditApiKey) {
    return new Response(JSON.stringify({ error: "AUDIT_API_KEY not configured on server" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (providedKey !== auditApiKey) {
    return new Response(JSON.stringify({ error: "Invalid or missing x-audit-api-key" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Parse body
  let body: AuditPayload;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!body.assets || !Array.isArray(body.assets) || !body.period) {
    return new Response(JSON.stringify({ error: "Missing 'assets' array or 'period' field" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Init Supabase with service role
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Resolve period_id
  const [yearStr, monthStr] = body.period.split("-");
  const periodDate = `${yearStr}-${monthStr}-01`;

  const { data: periodId, error: periodError } = await supabase.rpc("find_or_create_period", {
    p_competence_date: periodDate,
  });

  if (periodError || !periodId) {
    return new Response(JSON.stringify({ error: "Failed to resolve period", details: periodError?.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Load categories for mapping
  const { data: categories } = await supabase
    .from("fixed_assets_categories")
    .select("id, code, default_monthly_rate, default_useful_life_months");

  const catMap = new Map<string, { id: string; rate: number | null; life: number | null }>();
  if (categories) {
    for (const c of categories) {
      catMap.set(c.code, { id: c.id, rate: c.default_monthly_rate, life: c.default_useful_life_months });
    }
  }

  let inserted = 0;
  let updated = 0;
  const errors: { asset_code: string; error: string }[] = [];

  for (const asset of body.assets) {
    if (!asset.audit_source_id || !asset.asset_code) {
      errors.push({ asset_code: asset.asset_code || "unknown", error: "Missing audit_source_id or asset_code" });
      continue;
    }

    try {
      // Resolve category
      const catCode = asset.category || "outros";
      const catInfo = catMap.get(catCode);
      const categoryId = catInfo?.id || null;

      // Determine depreciation rate
      let monthlyRate = asset.monthly_depreciation_rate || 0;
      const usefulLife = asset.useful_life_months || 0;
      if (monthlyRate === 0 && usefulLife > 0) {
        monthlyRate = 100 / usefulLife;
      } else if (monthlyRate === 0 && catInfo?.rate) {
        monthlyRate = catInfo.rate;
      }

      // Calculate accumulated depreciation if acquisition_date provided
      let accDep = 0;
      if (asset.acquisition_date && asset.gross_value && monthlyRate > 0) {
        const acqDate = new Date(asset.acquisition_date);
        const periodEnd = new Date(Number(yearStr), Number(monthStr), 0); // last day
        const months = (periodEnd.getFullYear() * 12 + periodEnd.getMonth()) - (acqDate.getFullYear() * 12 + acqDate.getMonth());
        if (months > 0) {
          const depMonthly = asset.gross_value * (monthlyRate / 100);
          accDep = Math.min(Math.round(depMonthly * months * 100) / 100, asset.gross_value);
        }
      }

      const grossValue = asset.gross_value || 0;
      const netValue = grossValue - accDep;

      const record = {
        period_id: periodId,
        asset_code: asset.asset_code,
        asset_description: asset.asset_description || "",
        category: catCode,
        category_id: categoryId,
        asset_tag: asset.asset_tag || null,
        location: asset.location || "",
        responsible_name: asset.responsible_name || null,
        responsible_department: asset.responsible_department || null,
        serial_number: asset.serial_number || null,
        brand_model: asset.brand_model || null,
        acquisition_date: asset.acquisition_date || null,
        gross_value: grossValue,
        accumulated_depreciation: accDep,
        net_value: netValue,
        monthly_depreciation_rate: monthlyRate,
        useful_life_months: usefulLife,
        status: asset.status || "ativo",
        last_audit_date: asset.last_audit_date || null,
        audit_source_id: asset.audit_source_id,
        source: "auditoria",
        notes: asset.notes || null,
      };

      // Check if exists by audit_source_id
      const { data: existing } = await supabase
        .from("fixed_assets_items")
        .select("id")
        .eq("audit_source_id", asset.audit_source_id)
        .eq("period_id", periodId)
        .maybeSingle();

      if (existing) {
        const { error: updateErr } = await supabase
          .from("fixed_assets_items")
          .update(record)
          .eq("id", existing.id);

        if (updateErr) {
          errors.push({ asset_code: asset.asset_code, error: updateErr.message });
        } else {
          updated++;
        }
      } else {
        const { error: insertErr } = await supabase
          .from("fixed_assets_items")
          .insert(record);

        if (insertErr) {
          errors.push({ asset_code: asset.asset_code, error: insertErr.message });
        } else {
          inserted++;
        }
      }
    } catch (err: any) {
      errors.push({ asset_code: asset.asset_code, error: err.message || "Unknown error" });
    }
  }

  return new Response(
    JSON.stringify({ inserted, updated, errors }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
