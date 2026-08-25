#!/usr/bin/env node
/**
 * Automated recall/precision scoring harness for tier1-detector.js.
 *
 * Runs classifyField() against every sample in the adversarial test corpus
 * (extension/test/corpus/tier-{a,b,c}.corpus.js), scores per field-instance,
 * and produces a confusion matrix (TP/FP/FN/TN) rolled up per category and
 * per tier, checked against the binding accuracy bar from ADR-001 /
 * director-security:
 *
 *   Tier A (critical): recall >= 99.5%, precision >= 90%
 *   Tier B (moderate):  recall >= 95%,   precision >= 85%
 *   Tier C (low-stakes): recall >= 85%   (no precision floor set)
 *
 * Scoring rule per sample:
 *   - type: 'positive'      -> TP if classifyField() returns redact:true AND
 *                               tier === sample.expected.tier, else FN.
 *                               TP/FN are attributed to the sample's own
 *                               tier/category (what we were testing recall for).
 *   - type: 'hard_negative' -> FP if classifyField() returns redact:true
 *                               (attributed to whatever tier/category the
 *                               detector actually fired, since that tier's
 *                               precision is what's genuinely affected),
 *                               else TN.
 *
 * This is a real test run against the current implementation -- it does NOT
 * tune the corpus or the detector to hit the bar. See README.md in this
 * directory and the PR description for the honest result.
 *
 * Usage:
 *   node extension/test/run-scoring.js         (report only, exit 0)
 *   node extension/test/run-scoring.js --ci     (exit 1 if Tier A bar is not met)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { classifyField } from '../src/detection/tier1-detector.js';
import { tierACorpus } from './corpus/tier-a.corpus.js';
import { tierBCorpus } from './corpus/tier-b.corpus.js';
import { tierCCorpus } from './corpus/tier-c.corpus.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BAR = {
  A: { recall: 0.995, precision: 0.90 },
  B: { recall: 0.95, precision: 0.85 },
  C: { recall: 0.85, precision: null },
};

const FULL_DESIGN_SIZE = { A: 900, B: 630, C: 250 };

const allSamples = [...tierACorpus, ...tierBCorpus, ...tierCCorpus];

function emptyBucket() {
  return { tp: 0, fp: 0, fn: 0, tn: 0 };
}

const perCategory = {};
const perTier = { A: emptyBucket(), B: emptyBucket(), C: emptyBucket() };
const records = [];

function bump(map, key, field) {
  if (!map[key]) map[key] = emptyBucket();
  map[key][field] += 1;
}

for (const sample of allSamples) {
  const actual = classifyField(sample.field);
  let outcome;

  if (sample.type === 'positive') {
    const hit = actual.redact === true && actual.tier === sample.expected.tier;
    outcome = hit ? 'TP' : 'FN';
    bump(perCategory, sample.category, hit ? 'tp' : 'fn');
    bump(perTier, sample.tier, hit ? 'tp' : 'fn');
  } else {
    // hard_negative
    if (actual.redact === true) {
      outcome = 'FP';
      const attribCategory = actual.category || sample.category;
      const attribTier = actual.tier || sample.tier;
      bump(perCategory, attribCategory, 'fp');
      bump(perTier, attribTier, 'fp');
    } else {
      outcome = 'TN';
      bump(perCategory, sample.category, 'tn');
      bump(perTier, sample.tier, 'tn');
    }
  }

  records.push({
    id: sample.id,
    tier: sample.tier,
    category: sample.category,
    type: sample.type,
    variant: sample.variant,
    expected: sample.expected,
    actual,
    outcome,
  });
}

function recallOf(b) {
  const denom = b.tp + b.fn;
  return denom === 0 ? null : b.tp / denom;
}
function precisionOf(b) {
  const denom = b.tp + b.fp;
  return denom === 0 ? null : b.tp / denom;
}
function pct(x) {
  return x === null ? 'N/A' : `${(x * 100).toFixed(2)}%`;
}
function passFail(actualValue, barValue) {
  if (barValue === null) return 'n/a';
  if (actualValue === null) return 'FAIL (no data)';
  return actualValue >= barValue ? 'PASS' : 'FAIL';
}

console.log('='.repeat(78));
console.log('Tier 1 Detector -- Adversarial Corpus Scoring Report');
console.log('='.repeat(78));
console.log(`Total samples run: ${allSamples.length}`);
console.log(`  Tier A: ${tierACorpus.length} (full design: ${FULL_DESIGN_SIZE.A}, ${((tierACorpus.length / FULL_DESIGN_SIZE.A) * 100).toFixed(1)}% of full)`);
console.log(`  Tier B: ${tierBCorpus.length} (full design: ${FULL_DESIGN_SIZE.B}, ${((tierBCorpus.length / FULL_DESIGN_SIZE.B) * 100).toFixed(1)}% of full)`);
console.log(`  Tier C: ${tierCCorpus.length} (full design: ${FULL_DESIGN_SIZE.C}, ${((tierCCorpus.length / FULL_DESIGN_SIZE.C) * 100).toFixed(1)}% of full)`);
console.log('');

console.log('-'.repeat(78));
console.log('PER-TIER RESULTS vs binding accuracy bar');
console.log('-'.repeat(78));

const tierSummary = {};
for (const tier of ['A', 'B', 'C']) {
  const b = perTier[tier];
  const recall = recallOf(b);
  const precision = precisionOf(b);
  const bar = BAR[tier];
  tierSummary[tier] = {
    tp: b.tp, fp: b.fp, fn: b.fn, tn: b.tn,
    recall, precision,
    recallBar: bar.recall, precisionBar: bar.precision,
    recallResult: passFail(recall, bar.recall),
    precisionResult: bar.precision === null ? 'n/a' : passFail(precision, bar.precision),
  };
  console.log(`Tier ${tier}: TP=${b.tp} FP=${b.fp} FN=${b.fn} TN=${b.tn}`);
  console.log(`  Recall:    ${pct(recall)}  (bar >= ${pct(bar.recall)})  -> ${tierSummary[tier].recallResult}`);
  console.log(`  Precision: ${pct(precision)}  (bar ${bar.precision === null ? 'n/a' : `>= ${pct(bar.precision)}`})  -> ${tierSummary[tier].precisionResult}`);
  console.log('');
}

console.log('-'.repeat(78));
console.log('PER-CATEGORY BREAKDOWN');
console.log('-'.repeat(78));
const categorySummary = {};
for (const category of Object.keys(perCategory).sort()) {
  const b = perCategory[category];
  const recall = recallOf(b);
  const precision = precisionOf(b);
  categorySummary[category] = { tp: b.tp, fp: b.fp, fn: b.fn, tn: b.tn, recall, precision };
  console.log(`${category.padEnd(24)} TP=${b.tp} FP=${b.fp} FN=${b.fn} TN=${b.tn}  recall=${pct(recall)}  precision=${pct(precision)}`);
}
console.log('');

console.log('-'.repeat(78));
console.log('MISSES (FN) AND FALSE POSITIVES (FP) -- individual samples');
console.log('-'.repeat(78));
for (const r of records) {
  if (r.outcome === 'FN' || r.outcome === 'FP') {
    console.log(`[${r.outcome}] ${r.id} (${r.tier}/${r.category}, ${r.variant}) -> actual: tier=${r.actual.tier} category=${r.actual.category} redact=${r.actual.redact}`);
  }
}
console.log('');

const overallPass = tierSummary.A.recallResult === 'PASS' && tierSummary.A.precisionResult === 'PASS';

const report = {
  generatedAt: new Date().toISOString(),
  totalSamples: allSamples.length,
  corpusSize: { A: tierACorpus.length, B: tierBCorpus.length, C: tierCCorpus.length },
  fullDesignSize: FULL_DESIGN_SIZE,
  bar: BAR,
  perTier: tierSummary,
  perCategory: categorySummary,
  records,
};

const resultsDir = join(__dirname, 'results');
mkdirSync(resultsDir, { recursive: true });
writeFileSync(join(resultsDir, 'latest-run.json'), JSON.stringify(report, null, 2));
console.log(`Full JSON report written to extension/test/results/latest-run.json`);
console.log('='.repeat(78));

if (process.argv.includes('--ci') && !overallPass) {
  console.error('CI mode: Tier A accuracy bar not met.');
  process.exitCode = 1;
}
