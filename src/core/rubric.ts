/**
 * Rubric conventions shared by the validator and the self-check.
 *
 * A criterion with `forbidden` phrases is met only when the answer contains
 * none of them. That check is deterministic, so the learner does not decide
 * it: an answer containing a forbidden phrase fails the criterion.
 *
 * Pure functions; safe in the browser and in Node scripts.
 */
import type { Rubric, RubricCriterion } from "./content-schema";

/** The phrases that fail `criterion`, or [] for a normal one. */
export function forbiddenPhrases(criterion: Pick<RubricCriterion, "forbidden">): string[] {
  return (criterion.forbidden ?? []).map((p) => p.trim()).filter(Boolean);
}

export function isForbiddenCriterion(criterion: Pick<RubricCriterion, "forbidden">): boolean {
  return forbiddenPhrases(criterion).length > 0;
}

const norm = (text: string) => text.toLowerCase().replace(/\s+/g, " ");

/** The forbidden phrases of `criterion` that `answer` contains (case/space-insensitive). */
export function forbiddenHits(criterion: Pick<RubricCriterion, "forbidden">, answer: string): string[] {
  const a = norm(answer);
  return forbiddenPhrases(criterion).filter((phrase) => a.includes(norm(phrase)));
}

/** `mustMention` terms the text does not contain (case/space-insensitive). */
export function missingMentions(criterion: Pick<RubricCriterion, "mustMention">, text: string): string[] {
  const t = norm(text);
  return (criterion.mustMention ?? []).filter((term) => !t.includes(norm(term)));
}

/** One criterion's verdict, as the learner (or the phrase check) gives it. */
export type CriterionVerdict = {
  id: string;
  met: boolean;
  /** The forbidden phrase found, when the phrase check decided it. */
  evidence?: string;
};

/**
 * Forbidden phrases override any verdict: a criterion whose phrase appears in
 * the answer is not met, with the phrase as evidence; one whose phrases are
 * all absent is met.
 */
export function applyForbidden(rubric: Rubric, answer: string, verdicts: readonly CriterionVerdict[]): CriterionVerdict[] {
  const byId = new Map(verdicts.map((v) => [v.id, v]));
  return rubric.criteria.map((c) => {
    const hits = forbiddenHits(c, answer);
    if (hits.length) return { id: c.id, met: false, evidence: hits.join(" / ") };
    if (isForbiddenCriterion(c)) return { id: c.id, met: true };
    return byId.get(c.id) ?? { id: c.id, met: false };
  });
}

/** Weighted share of criteria met, in [0, 1]. */
export function rubricQ(rubric: Rubric, verdicts: readonly CriterionVerdict[]): number {
  const met = new Map(verdicts.map((v) => [v.id, v.met]));
  const total = rubric.criteria.reduce((sum, c) => sum + c.weight, 0);
  if (total <= 0) return 0;
  return rubric.criteria.reduce((sum, c) => sum + (met.get(c.id) ? c.weight : 0), 0) / total;
}

/** Per-KC q from criterion verdicts: each KC scores the weighted share of its criteria met. */
export function rubricQByKc(rubric: Rubric, verdicts: readonly CriterionVerdict[]): Record<string, number> {
  const met = new Map(verdicts.map((v) => [v.id, v.met]));
  const acc = new Map<string, { got: number; of: number }>();
  for (const c of rubric.criteria) {
    for (const kc of c.kcs) {
      const a = acc.get(kc) ?? { got: 0, of: 0 };
      a.of += c.weight;
      if (met.get(c.id)) a.got += c.weight;
      acc.set(kc, a);
    }
  }
  return Object.fromEntries([...acc].map(([kc, a]) => [kc, a.of > 0 ? a.got / a.of : 0]));
}
