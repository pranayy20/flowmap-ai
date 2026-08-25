/**
 * Tier C adversarial test corpus — low-stakes categories per ADR-001: pricing, generic
 * business terms. tier1-detector.js has ZERO Tier C rules implemented as of this pass
 * (no LABEL_HEURISTICS or CONTENT_PATTERNS entry with tier: Tier.C at all) — every
 * positive sample below is expected to be a miss against the current implementation.
 * That is reported as a real finding, not smoothed over; see extension/test/README.md.
 *
 * Only recall is binding for Tier C per the accuracy bar table (no precision floor set),
 * but hard negatives are still included for diagnostic completeness.
 *
 * Scaled-down subset of qa-team-lead's full Sprint 1 design (250 Tier C samples).
 */

export const tierCCorpus = [
  // ===================== PRICING =====================
  { id: 'C-price-pos-001', tier: 'C', category: 'pricing', type: 'positive', variant: 'label_unit_price', field: { label: 'Unit Price', name: '', placeholder: '', type: 'text', value: '$49.99' }, expected: { redact: true, tier: 'C', category: 'pricing' } },
  { id: 'C-price-pos-002', tier: 'C', category: 'pricing', type: 'positive', variant: 'label_price_no_symbol', field: { label: 'Price', name: '', placeholder: '', type: 'text', value: '129.00' }, expected: { redact: true, tier: 'C', category: 'pricing' } },
  { id: 'C-price-pos-003', tier: 'C', category: 'pricing', type: 'positive', variant: 'label_total_price_comma', field: { label: 'Total Price', name: '', placeholder: '', type: 'text', value: '$1,299.00' }, expected: { redact: true, tier: 'C', category: 'pricing' } },
  { id: 'C-price-pos-004', tier: 'C', category: 'pricing', type: 'positive', variant: 'label_list_price_currency_code', field: { label: 'List Price', name: '', placeholder: '', type: 'text', value: 'USD 89.50' }, expected: { redact: true, tier: 'C', category: 'pricing' } },
  { id: 'C-price-neg-001', tier: 'C', category: 'pricing', type: 'hard_negative', variant: 'quantity_field', field: { label: 'Quantity', name: '', placeholder: '', type: 'text', value: '3' }, expected: { redact: false, tier: null, category: null } },
  { id: 'C-price-neg-002', tier: 'C', category: 'pricing', type: 'hard_negative', variant: 'sku_field', field: { label: 'SKU', name: '', placeholder: '', type: 'text', value: 'WH-1000-BLK' }, expected: { redact: false, tier: null, category: null } },

  // ===================== GENERIC BUSINESS TERMS =====================
  { id: 'C-biz-pos-001', tier: 'C', category: 'generic_business_terms', type: 'positive', variant: 'department', field: { label: 'Department', name: '', placeholder: '', type: 'text', value: 'Sales' }, expected: { redact: true, tier: 'C', category: 'generic_business_terms' } },
  { id: 'C-biz-pos-002', tier: 'C', category: 'generic_business_terms', type: 'positive', variant: 'project_name', field: { label: 'Project Name', name: '', placeholder: '', type: 'text', value: 'Q3 Onboarding Revamp' }, expected: { redact: true, tier: 'C', category: 'generic_business_terms' } },
  { id: 'C-biz-pos-003', tier: 'C', category: 'generic_business_terms', type: 'positive', variant: 'business_unit', field: { label: 'Business Unit', name: '', placeholder: '', type: 'text', value: 'North America Retail' }, expected: { redact: true, tier: 'C', category: 'generic_business_terms' } },
  { id: 'C-biz-pos-004', tier: 'C', category: 'generic_business_terms', type: 'positive', variant: 'cost_center', field: { label: 'Cost Center', name: '', placeholder: '', type: 'text', value: 'CC-4471' }, expected: { redact: true, tier: 'C', category: 'generic_business_terms' } },
  { id: 'C-biz-neg-001', tier: 'C', category: 'generic_business_terms', type: 'hard_negative', variant: 'favorite_color_field', field: { label: 'Favorite Color', name: '', placeholder: '', type: 'text', value: 'Blue' }, expected: { redact: false, tier: null, category: null } },
  { id: 'C-biz-neg-002', tier: 'C', category: 'generic_business_terms', type: 'hard_negative', variant: 'random_notes_field', field: { label: 'Random Notes', name: '', placeholder: '', type: 'text', value: 'lorem ipsum dolor' }, expected: { redact: false, tier: null, category: null } },
];
