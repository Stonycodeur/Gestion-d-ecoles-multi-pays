import type { GradingScale } from '@ecolemanager/shared';

export const ACTIVE_SCALE_SQL = `
  SELECT gs.* FROM public.tenants t
  LEFT JOIN LATERAL (SELECT grading_scale_code FROM public.tenant_settings ts WHERE ts.tenant_id = t.id AND ts.effective_from <= CURRENT_DATE
                     ORDER BY effective_from DESC LIMIT 1) o ON true
  JOIN public.education_systems es ON es.country_code = t.country_code AND es.school_type = t.school_type
  JOIN public.grading_scales gs ON gs.country_code = t.country_code AND gs.code = COALESCE(o.grading_scale_code, es.grading_scale_code)
  WHERE t.slug = $1 LIMIT 1`;

export function rowToScale(r: any): GradingScale {
  return { code: r.code, type: r.type, min: Number(r.min_value), max: Number(r.max_value), step: Number(r.step), decimals: Number(r.decimals),
    passMark: Number(r.pass_mark), rounding: r.rounding, bands: r.bands ?? [] };
}
