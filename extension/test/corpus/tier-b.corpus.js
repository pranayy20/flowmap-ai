/**
 * Tier B adversarial test corpus — moderate categories per ADR-001: business data,
 * low-weight PII, internal URLs. tier1-detector.js's actual Tier B rules only cover
 * email/phone (label + content) and address (label only) — 'business data' and
 * 'internal URLs' have no implementation at all as of this pass. Those subcategories
 * are included below anyway (all expected-positive) because the accuracy bar is scored
 * against the *spec's* category list, not against what happens to be implemented —
 * see extension/test/README.md for how the harness reports this as a real gap rather
 * than adjusting the corpus to avoid it.
 *
 * Scaled-down subset of qa-team-lead's full Sprint 1 design (630 Tier B samples).
 */

export const tierBCorpus = [
  // ===================== EMAIL =====================
  { id: 'B-email-pos-001', tier: 'B', category: 'email', type: 'positive', variant: 'label_email', field: { label: 'Email', name: '', placeholder: '', type: 'email', value: 'user@example.com' }, expected: { redact: true, tier: 'B', category: 'email' } },
  { id: 'B-email-pos-002', tier: 'B', category: 'email', type: 'positive', variant: 'label_via_name', field: { label: '', name: 'email_address', placeholder: '', type: 'text', value: 'jane.doe@corp-mail.io' }, expected: { redact: true, tier: 'B', category: 'email' } },
  { id: 'B-email-pos-003', tier: 'B', category: 'email', type: 'positive', variant: 'content_only_mislabeled', field: { label: 'Contact', name: '', placeholder: '', type: 'text', value: 'j.smith@example.org' }, expected: { redact: true, tier: 'B', category: 'email' } },
  { id: 'B-email-pos-004', tier: 'B', category: 'email', type: 'positive', variant: 'placeholder_only', field: { label: '', name: '', placeholder: 'Enter your email', type: 'text', value: 'a@b.co' }, expected: { redact: true, tier: 'B', category: 'email' } },
  { id: 'B-email-pos-005', tier: 'B', category: 'email', type: 'positive', variant: 'content_only_plus_addressing', field: { label: '', name: 'val', placeholder: '', type: 'text', value: 'user+test@example.com' }, expected: { redact: true, tier: 'B', category: 'email' } },
  { id: 'B-email-neg-001', tier: 'B', category: 'email', type: 'hard_negative', variant: 'at_mention_no_domain', field: { label: 'Notes', name: '', placeholder: '', type: 'text', value: 'Please loop in @channel for review' }, expected: { redact: false, tier: null, category: null } },
  { id: 'B-email-neg-002', tier: 'B', category: 'email', type: 'hard_negative', variant: 'version_tag_at_symbol', field: { label: 'Build Tag', name: '', placeholder: '', type: 'text', value: 'v2.3@build' }, expected: { redact: false, tier: null, category: null } },
  { id: 'B-email-neg-003', tier: 'B', category: 'email', type: 'hard_negative', variant: 'plain_text_not_email', field: { label: 'Comment', name: '', placeholder: '', type: 'text', value: 'not-an-email' }, expected: { redact: false, tier: null, category: null } },

  // ===================== PHONE =====================
  { id: 'B-phone-pos-001', tier: 'B', category: 'phone', type: 'positive', variant: 'label_phone_parens', field: { label: 'Phone', name: '', placeholder: '', type: 'tel', value: '(415) 555-0132' }, expected: { redact: true, tier: 'B', category: 'phone' } },
  { id: 'B-phone-pos-002', tier: 'B', category: 'phone', type: 'positive', variant: 'label_via_name_dashed', field: { label: '', name: 'phone_number', placeholder: '', type: 'text', value: '415-555-0148' }, expected: { redact: true, tier: 'B', category: 'phone' } },
  { id: 'B-phone-pos-003', tier: 'B', category: 'phone', type: 'positive', variant: 'label_intl_plus1', field: { label: 'Mobile', name: '', placeholder: '', type: 'text', value: '+1 415 555 0199' }, expected: { redact: true, tier: 'B', category: 'phone' } },
  { id: 'B-phone-pos-004', tier: 'B', category: 'phone', type: 'positive', variant: 'content_only_mislabeled_dashed', field: { label: '', name: 'val', placeholder: '', type: 'text', value: '212-555-0173' }, expected: { redact: true, tier: 'B', category: 'phone' } },
  { id: 'B-phone-neg-001', tier: 'B', category: 'phone', type: 'hard_negative', variant: 'tracking_id_phone_shaped', field: { label: 'Order Tracking ID', name: '', placeholder: '', type: 'text', value: '415-555-0190' }, expected: { redact: false, tier: null, category: null } },
  { id: 'B-phone-neg-002', tier: 'B', category: 'phone', type: 'hard_negative', variant: 'product_code_dotted_phone_shaped', field: { label: 'Product Code', name: '', placeholder: '', type: 'text', value: '800.555.0100' }, expected: { redact: false, tier: null, category: null } },
  { id: 'B-phone-neg-003', tier: 'B', category: 'phone', type: 'hard_negative', variant: 'short_extension_7digit', field: { label: 'Ext', name: '', placeholder: '', type: 'text', value: '555-0199' }, expected: { redact: false, tier: null, category: null } },

  // ===================== ADDRESS =====================
  { id: 'B-addr-pos-001', tier: 'B', category: 'address', type: 'positive', variant: 'label_address', field: { label: 'Address', name: '', placeholder: '', type: 'text', value: '123 Main St' }, expected: { redact: true, tier: 'B', category: 'address' } },
  { id: 'B-addr-pos-002', tier: 'B', category: 'address', type: 'positive', variant: 'label_street', field: { label: 'Street', name: '', placeholder: '', type: 'text', value: 'Elm Ave' }, expected: { redact: true, tier: 'B', category: 'address' } },
  { id: 'B-addr-pos-003', tier: 'B', category: 'address', type: 'positive', variant: 'label_zip', field: { label: 'Zip', name: '', placeholder: '', type: 'text', value: '10001' }, expected: { redact: true, tier: 'B', category: 'address' } },
  { id: 'B-addr-pos-004', tier: 'B', category: 'address', type: 'positive', variant: 'label_postal_code', field: { label: 'Postal Code', name: '', placeholder: '', type: 'text', value: 'SW1A 1AA' }, expected: { redact: true, tier: 'B', category: 'address' } },
  { id: 'B-addr-pos-005', tier: 'B', category: 'address', type: 'positive', variant: 'content_only_full_street_address_mislabeled', field: { label: '', name: 'val', placeholder: '', type: 'text', value: '456 Oak Street, Springfield, IL 62704' }, expected: { redact: true, tier: 'B', category: 'address' } },
  { id: 'B-addr-pos-006', tier: 'B', category: 'address', type: 'positive', variant: 'content_only_full_address_generic_label', field: { label: 'Location', name: '', placeholder: '', type: 'text', value: '789 Pine Rd, Austin, TX' }, expected: { redact: true, tier: 'B', category: 'address' } },
  { id: 'B-addr-neg-001', tier: 'B', category: 'address', type: 'hard_negative', variant: 'ip_address_label_substring_address', field: { label: 'IP Address', name: '', placeholder: '', type: 'text', value: '10.0.0.5' }, expected: { redact: false, tier: null, category: null } },

  // ===================== BUSINESS DATA (no content or label rule implemented) =====================
  { id: 'B-biz-pos-001', tier: 'B', category: 'business_data', type: 'positive', variant: 'customer_name', field: { label: 'Customer Name', name: '', placeholder: '', type: 'text', value: 'Acme Corp - Jordan Lee' }, expected: { redact: true, tier: 'B', category: 'business_data' } },
  { id: 'B-biz-pos-002', tier: 'B', category: 'business_data', type: 'positive', variant: 'order_total', field: { label: 'Order Total', name: '', placeholder: '', type: 'text', value: '$4,250.00' }, expected: { redact: true, tier: 'B', category: 'business_data' } },
  { id: 'B-biz-pos-003', tier: 'B', category: 'business_data', type: 'positive', variant: 'deal_stage', field: { label: 'Deal Stage', name: '', placeholder: '', type: 'text', value: 'Negotiation' }, expected: { redact: true, tier: 'B', category: 'business_data' } },
  { id: 'B-biz-pos-004', tier: 'B', category: 'business_data', type: 'positive', variant: 'contract_id', field: { label: 'Contract ID', name: '', placeholder: '', type: 'text', value: 'CTR-2026-00931' }, expected: { redact: true, tier: 'B', category: 'business_data' } },
  { id: 'B-biz-pos-005', tier: 'B', category: 'business_data', type: 'positive', variant: 'customer_company', field: { label: 'Customer Company', name: '', placeholder: '', type: 'text', value: 'Northwind Traders' }, expected: { redact: true, tier: 'B', category: 'business_data' } },
  { id: 'B-biz-pos-006', tier: 'B', category: 'business_data', type: 'positive', variant: 'account_owner', field: { label: 'Account Owner', name: '', placeholder: '', type: 'text', value: 'Sam Patel' }, expected: { redact: true, tier: 'B', category: 'business_data' } },

  // ===================== INTERNAL URLS (no rule implemented) =====================
  { id: 'B-url-pos-001', tier: 'B', category: 'internal_url', type: 'positive', variant: 'internal_wiki_link', field: { label: 'Internal Wiki Link', name: '', placeholder: '', type: 'text', value: 'https://wiki.internal.flowmap.corp/eng/runbooks' }, expected: { redact: true, tier: 'B', category: 'internal_url' } },
  { id: 'B-url-pos-002', tier: 'B', category: 'internal_url', type: 'positive', variant: 'private_ip_admin_link', field: { label: '', name: 'val', placeholder: '', type: 'text', value: 'http://192.168.1.15:8080/admin/dashboard' }, expected: { redact: true, tier: 'B', category: 'internal_url' } },
  { id: 'B-url-pos-003', tier: 'B', category: 'internal_url', type: 'positive', variant: 'intranet_url', field: { label: 'Intranet URL', name: '', placeholder: '', type: 'text', value: 'https://intranet.flowmap.local/hr/policies' }, expected: { redact: true, tier: 'B', category: 'internal_url' } },
  { id: 'B-url-pos-004', tier: 'B', category: 'internal_url', type: 'positive', variant: 'internal_api_link_via_name', field: { label: '', name: 'internal_link', placeholder: '', type: 'text', value: 'https://internal-api.flowmap.corp/v1/customers' }, expected: { redact: true, tier: 'B', category: 'internal_url' } },
  { id: 'B-url-pos-005', tier: 'B', category: 'internal_url', type: 'positive', variant: 'internal_status_link', field: { label: 'Service Status Link', name: '', placeholder: '', type: 'text', value: 'https://flowmap.internal/status' }, expected: { redact: true, tier: 'B', category: 'internal_url' } },
  { id: 'B-url-pos-006', tier: 'B', category: 'internal_url', type: 'positive', variant: 'private_ip_admin_link_unlabeled', field: { label: '', name: '', placeholder: '', type: 'text', value: 'http://10.20.30.40/admin' }, expected: { redact: true, tier: 'B', category: 'internal_url' } },
];
