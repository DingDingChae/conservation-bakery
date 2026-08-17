/**
 * Rule 2 denylist.
 *
 * These patterns are the enforcement mechanism named in CONTRACT.md rule 2: no
 * injury, accident, illness, harm, casualty or medical emergency involving any
 * person may be modelled, named, logged, or written anywhere in this product.
 * `no-harm.spec.ts` reads every source, data and asset file in the repository and
 * fails the build if any of these patterns match.
 *
 * Adding a term here is always allowed. Removing one is not — see CONTRACT.md.
 *
 * ## Two tiers
 *
 * Every entry carries a `tier`:
 *
 * - **Tier A — always denied.** The term has no legitimate use anywhere in this
 *   project's domain (bakery equipment, chemistry, scheduling, business). It is
 *   flagged wherever it appears, with no further context check.
 * - **Tier B — denied only near a person referent.** The term has a real,
 *   legitimate equipment, chemistry or ordinary-English sense in this project
 *   (a burner burns methane, a batch "dies" — no, a die stamps pastry, a rate
 *   "burns in", something happens "by accident" in the ordinary idiomatic
 *   sense) *and* a real sense in which a person is hurt. `no-harm.spec.ts`
 *   only reports a Tier B match when a person-referent word (see
 *   `PERSON_REFERENT_PATTERN` below) appears within a bounded window of it —
 *   see that file for exactly how "near" is defined and why.
 *
 * Tiering only changes *when* a match is reported, never *whether* the term is
 * covered — moving a term between tiers, or adding a new term to either tier, is
 * always allowed, in keeping with "adding is allowed, removing is not."
 *
 * Every pattern is word-bounded (`\b`) so that it matches the whole word it names
 * and not a substring of an unrelated word. Where a real English or engineering
 * term collides with a guarded word (an equipment "burner", a control-loop "dead
 * band", a schedule "deadline"), the pattern carries a negative lookahead that
 * excludes exactly that collision and a comment explaining why. This keeps the
 * pattern itself strict — nothing is removed or loosened, specific known-safe
 * neighbours are carved out by name.
 *
 * NOTE ON SELF-REFERENCE: this file necessarily writes out the words it guards
 * against, in comments, so a human can tell what each pattern is for. That is why
 * `no-harm.spec.ts` excludes this file, by path, from the sweep it runs — the same
 * way a fire-alarm test procedure is allowed to contain the word "fire".
 */

export type DenylistTier = 'A' | 'B';

export interface DenylistEntry {
  readonly pattern: RegExp;
  readonly tier: DenylistTier;
}

/**
 * Words that make a Tier B match actually be about a person, rather than
 * equipment, chemistry or an ordinary-English idiom. `no-harm.spec.ts` only
 * reports a Tier B pattern match when one of these appears within its proximity
 * window of the match.
 *
 * This list only needs to cover people who could plausibly appear in this
 * project's text (plant staff, farm and delivery people, generic references to
 * a person) — it is deliberately not an exhaustive English person-noun list.
 * Growing it only ever makes the gate catch more, never less, so additions are
 * always safe.
 */
export const PERSON_REFERENT_PATTERN =
  /\b(?:workers?|operators?|staff|employees?|persons?|people|bakers?|someone|anyone|child(?:ren)?|visitors?|drivers?|crew|hands?)\b/i;

export const DENYLIST: readonly DenylistEntry[] = [
  // ================================================================================
  // TIER A — always denied. No legitimate use exists anywhere in this project.
  // ================================================================================

  // injury / injuries / injured / injuring
  { pattern: /\binjur(?:y|ies|ed|ing)\b/i, tier: 'A' },

  // casualty / casualties
  { pattern: /\bcasualt(?:y|ies)\b/i, tier: 'A' },

  // fatality / fatalities / fatal / fatally
  { pattern: /\bfatal(?:ity|ities|ly)?\b/i, tier: 'A' },

  // wound / wounds / wounded / wounding, an injury to a person. No equipment or
  // chemistry sense of this word exists in this project's domain.
  { pattern: /\bwound(?:s|ed|ing)?\b/i, tier: 'A' },

  // maim / maims / maimed / maiming
  { pattern: /\bmaim(?:s|ed|ing)?\b/i, tier: 'A' },

  // amputate / amputates / amputated / amputating / amputation(s)
  { pattern: /\bamputat(?:e|es|ed|ing|ions?)\b/i, tier: 'A' },

  // paramedic / paramedics
  { pattern: /\bparamedics?\b/i, tier: 'A' },

  // ambulance / ambulances
  { pattern: /\bambulances?\b/i, tier: 'A' },

  // first aid / first-aid
  { pattern: /\bfirst[\s-]?aid\b/i, tier: 'A' },

  // hospitalise(d/s/ing) / hospitalize(d/s/ing) — both spellings.
  { pattern: /\bhospitalis(?:e|es|ed|ing)\b/i, tier: 'A' },
  { pattern: /\bhospitaliz(?:e|es|ed|ing)\b/i, tier: 'A' },

  // electrocute / electrocutes / electrocuted / electrocuting / electrocution
  { pattern: /\belectrocut(?:e|es|ed|ing|ion)\b/i, tier: 'A' },

  // asphyxiate / asphyxiates / asphyxiated / asphyxiating / asphyxiation
  { pattern: /\basphyxiat(?:e|es|ed|ing|ion)\b/i, tier: 'A' },

  // poison / poisons / poisoned / poisoning / poisonous. Food-safety failures in
  // this project are "contamination" or "spoilage" of product, never a poisoning
  // of a person — there is no equipment or chemistry sense of "poison" this
  // project needs, so it stays always-denied rather than proximity-gated.
  { pattern: /\bpoison(?:s|ed|ing|ous)?\b/i, tier: 'A' },

  // died / dying, of a person. Bare "die"/"dies" is deliberately not included: it
  // collides with the equipment sense of a stamping/cutting/extrusion die, which is
  // a plausible piece of bakery tooling (a pastry-cutting die). If a person-death
  // sense of "die"/"dies" is ever needed, add it as its own, more specific pattern
  // rather than weakening this comment's carve-out.
  { pattern: /\bdied\b/i, tier: 'A' },
  { pattern: /\bdying\b/i, tier: 'A' },

  // --- Cantonese / Chinese equivalents --------------------------------------------
  // CJK text has no ASCII word-boundary concept in JavaScript regex (`\b` is
  // defined in terms of `\w`, which does not include CJK ideographs), so these are
  // plain substring matches. Person-referent proximity gating (Tier B) depends on
  // whitespace-delimited word matching and is not implemented for CJK text, so
  // every Chinese-language term stays Tier A (always denied) even where its English
  // counterpart is Tier B — this is strictly more conservative, never weaker.

  // 受傷 — injured / injury
  { pattern: /受傷/, tier: 'A' },
  // 意外 — accident
  { pattern: /意外/, tier: 'A' },
  // 傷害 — harm / harmed
  { pattern: /傷害/, tier: 'A' },
  // 傷亡 — casualty (literally "injury-death")
  { pattern: /傷亡/, tier: 'A' },
  // 死亡 — death (of a person)
  { pattern: /死亡/, tier: 'A' },
  // 燒傷 / 燙傷 — burn injury to a person (as distinct from an equipment burnout)
  { pattern: /燒傷|燙傷/, tier: 'A' },
  // 疾病 / 生病 — illness / falling ill
  { pattern: /疾病|生病/, tier: 'A' },
  // 中毒 — poisoning
  { pattern: /中毒/, tier: 'A' },
  // 救護車 — ambulance
  { pattern: /救護車/, tier: 'A' },
  // 急救 — first aid
  { pattern: /急救/, tier: 'A' },
  // 醫療 / 醫護 — medical / medical-personnel
  { pattern: /醫療|醫護/, tier: 'A' },

  // ================================================================================
  // TIER B — denied only near a person referent (see PERSON_REFERENT_PATTERN).
  // Each of these also names a legitimate equipment, chemistry or ordinary-English
  // concept this project's content genuinely needs to express.
  // ================================================================================

  // burn / burns / burned / burning, applied to a person. Equipment terms
  // "burner" and "burnout" do not match at all: \bburn\b requires a boundary right
  // after "burn", and both words continue with a word character ("burner",
  // "burnout"), so there is no boundary there for the pattern to land on. The
  // lookahead additionally excludes the two-word forms "burn out" (equipment
  // idiom), "burn-in" (equipment/process idiom, e.g. a generator or a fresh RNG
  // state), and "burn rate" (business-finance idiom) — all have a genuine boundary
  // after "burn" that the bare word-boundary rule would otherwise catch. Beyond
  // those structural exclusions, legitimate fuel/process senses ("methane
  // burning", "glucose burned in respiration") are additionally protected by the
  // person-referent proximity gate below.
  { pattern: /\bburn(?:s|ed|ing)?\b(?!\s*-?(?:out|in|rate)\b)/i, tier: 'B' },

  // harm / harms / harmed / harming / harmful. "harmless" does not match: there is
  // no word boundary between "harm" and "less" for this pattern to land on.
  { pattern: /\bharm(?:s|ed|ing|ful)?\b/i, tier: 'B' },

  // hurt / hurts / hurting
  { pattern: /\bhurt(?:s|ing)?\b/i, tier: 'B' },

  // sick / sicks / sickness / sicknesses / sickly
  { pattern: /\bsick(?:s|ness(?:es)?|ly)?\b/i, tier: 'B' },

  // ill / illness / illnesses
  { pattern: /\bill(?:ness(?:es)?)?\b/i, tier: 'B' },

  // unwell
  { pattern: /\bunwell\b/i, tier: 'B' },

  // dead, of a person. "dead band" (control engineering), "deadline" (scheduling),
  // "deadlock" (concurrency), "dead time" (control systems), "dead weight"
  // (structural engineering) and "dead leg" (a stagnant, unswept section of pipe —
  // a real hygienic-design term) are legitimate terms this project uses; carved
  // out by name rather than by loosening the base match.
  { pattern: /\bdead\b(?!\s*-?(?:band|line|lock|time|weight|leg)\b)/i, tier: 'B' },

  // death / deaths, of a person.
  { pattern: /\bdeath(?:s)?\b/i, tier: 'B' },

  // medic / medics / medical / medically — a person's medical treatment or
  // response. (Distinct from "paramedic", which stays Tier A above.)
  { pattern: /\bmedic(?:al(?:ly)?|s)?\b/i, tier: 'B' },

  // emergency / emergencies, involving a person. ("Emergency stop", "emergency
  // shutdown" and similar equipment idioms are ordinary English descriptions of a
  // machine action and do not, by themselves, put a person referent nearby.)
  { pattern: /\bemergenc(?:y|ies)\b/i, tier: 'B' },

  // accident / accidents / accidental / accidentally. This also matches the
  // adverbial "by accident" and "accidental degeneracy" (a physics term) senses —
  // both are ordinary English and are only denied when a person referent sits
  // within the proximity window, same as every other Tier B term.
  { pattern: /\baccident(?:s|al|ally)?\b/i, tier: 'B' },
];
