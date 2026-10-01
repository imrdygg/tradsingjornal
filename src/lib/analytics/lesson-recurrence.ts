import type { Lesson, LessonKind } from '../../types';

/**
 * Repetition in the trader's own lessons.
 *
 * A lesson is something the trader noticed and wrote down. The value of the library is not the
 * twentieth entry in it — it is recognising that the fifth, the ninth and the fourteenth are the
 * same finding written three different ways. The note a trader keeps having to write down is the
 * one they have not actually learned yet, and that is the thing this module sets out to show.
 *
 * It works deterministically, on the device, from the trader's own words. It sits beside the
 * coach's "read my lessons" card rather than replacing it: the coach brings a model, is bounded
 * (the digest sends the newest few lessons and trims the notes) and costs a call, while this
 * reads the whole library, costs nothing and returns the same answer every time — so it can be
 * trusted and unit-tested. Neither is allowed to turn a lesson into a trade call or a signal.
 *
 * Two reads come out of it:
 *
 *   1. Clusters — lessons that are the same finding in different words, or that share the tags
 *      the trader filed them under. Each cluster says how many times a finding repeats, when it
 *      first and last appeared, and how strongly it repeats.
 *   2. Recurring terms — the words the trader keeps reaching for, so an idea that was never
 *      written down as its own lesson is still visible across the ones that were.
 *
 * Nothing here reads a lesson's images or clips: repetition is a fact about the trader's words,
 * and the media is not something this module could compare anyway.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * The canonical lesson kinds, mirrored here so this module stays a leaf that imports only the
 * shared types — the same reason `behavior.ts` re-states a couple of tiny helpers rather than
 * reaching back into another layer. The list is small and stable; `lessons.ts` remains the one
 * place the UI reads its labels from.
 */
const LESSON_KINDS: readonly LessonKind[] = [
  'pattern',
  'behavior',
  'mistake',
  'psychology',
  'other',
];

/** Common English filler, dropped before any comparison so grammar never counts as a theme. */
const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'also', 'am', 'an', 'and', 'any',
  'are', 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both',
  'but', 'by', 'can', 'could', 'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'few',
  'for', 'from', 'further', 'get', 'gets', 'getting', 'go', 'goes', 'going', 'gone', 'got',
  'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'him', 'his', 'how', 'i', 'if',
  'in', 'into', 'is', 'it', 'its', 'just', 'know', 'knew', 'known', 'make', 'makes', 'made', 'me',
  'more', 'most', 'my', 'need', 'needs', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once',
  'only', 'or', 'other', 'our', 'out', 'over', 'own', 'same', 'say', 'said', 'see', 'saw', 'seen',
  'she', 'should', 'so', 'some', 'still', 'such', 'take', 'takes', 'took', 'than', 'that', 'the',
  'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too',
  'under', 'until', 'up', 'use', 'used', 'using', 'very', 'want', 'wants', 'wanted', 'was', 'we',
  'went', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with',
  'would', 'you', 'your', 'yours',
]);

/**
 * Very generic journal words, dropped so the recurring-term list reads as themes rather than as
 * the vocabulary every entry shares. Deliberately short, and deliberately NOT including words
 * that carry the trader's meaning — "stop", "target", "high", "low", "sweep", "swept" all stay,
 * because an over-eager list here would hide the very repetitions this module exists to show.
 */
const GENERIC_DOMAIN_WORDS = new Set([
  'trade', 'trades', 'trading', 'market', 'markets', 'chart', 'charts', 'time', 'times', 'day',
  'days', 'today', 'tomorrow', 'yesterday', 'thing', 'things', 'think', 'thought', 'setup',
  'setups', 'entry', 'entries', 'exit', 'exits',
]);

/**
 * A light suffix stem, so "reverses", "reversed" and "reversing" all compare as `revers`.
 *
 * Not a real stemmer: it only collapses the handful of endings that English notes use most, and
 * it is intentionally conservative because an aggressive stem would merge words that mean
 * different things to a trader. Getting this wrong costs recall, not correctness.
 */
function stemToken(token: string): string {
  const t = token.replace(/'s$/, '');
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 5 && t.endsWith('ing')) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith('ed')) return t.slice(0, -2);
  if (t.length > 4 && t.endsWith('es')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

/**
 * Every meaningful word in a piece of text, keyed by its stem and valued by its real spelling.
 *
 * The stem is what gets compared; the original word is kept as the label so a recurrence can be
 * shown as "reverses" rather than as the stem it was reduced to, which would read as a typo.
 * The first spelling encountered wins, and lessons are read oldest first, so the label is the
 * trader's own earliest wording of the idea.
 */
function tokenize(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || raw.length < 3) continue;
    if (STOPWORDS.has(raw) || GENERIC_DOMAIN_WORDS.has(raw)) continue;
    const stem = stemToken(raw);
    if (stem.length >= 3 && !out.has(stem)) out.set(stem, raw);
  }
  return out;
}

/**
 * A tag reduced to the key it is compared by.
 *
 * Tags are matched whole, not tokenised: the trader's own filing vocabulary ("pre-open",
 * "liquidity sweep") is what makes two notes belong together, and splitting a hyphenated tag
 * into words would lose that. Casing and inner whitespace are the only things normalised.
 */
function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, '-');
}

/** How a lesson with no kind recorded is read, matching the storage default. */
function kindOf(lesson: { kind?: LessonKind }): LessonKind {
  return lesson.kind && LESSON_KINDS.includes(lesson.kind) ? lesson.kind : 'other';
}

// ---------------------------------------------------------------------------
// The entry shape, read for comparison
// ---------------------------------------------------------------------------

interface LessonSignature {
  id: string;
  title: string;
  kind: LessonKind;
  createdAt: string;
  /** Every meaningful word in the title and notes, by stem. */
  tokens: Set<string>;
  /** Just the title's words, which weigh more heavily than the body. */
  titleTokens: Set<string>;
  /** Stem -> the trader's own spelling of one word behind it, for display. */
  labels: Map<string, string>;
  /** Normalised tag key -> the trader's original spelling, for display. */
  tags: Map<string, string>;
}

/**
 * The parts of a lesson the comparison reads.
 *
 * Deliberately looser than `Lesson` so a draft that is still being typed — no id yet, no
 * timestamps, media not yet attached — can be compared against the library without having to be
 * dressed up as a saved record first.
 */
export interface LessonInput {
  id?: string;
  title?: string;
  notes?: string;
  kind?: LessonKind;
  createdAt?: string;
  tags?: string[];
}

function signatureOf(lesson: LessonInput): LessonSignature {
  const title = (lesson.title ?? '').trim();
  const notes = lesson.notes ?? '';
  const titleWords = tokenize(title);
  const bodyWords = tokenize(notes);
  const titleTokens = new Set(titleWords.keys());
  const tokens = new Set([...titleWords.keys(), ...bodyWords.keys()]);
  // A title's spelling labels the word when both title and body use it.
  const labels = new Map(titleWords);
  for (const [stem, raw] of bodyWords) if (!labels.has(stem)) labels.set(stem, raw);

  const tags = new Map<string, string>();
  for (const tag of lesson.tags ?? []) {
    const key = normalizeTag(tag);
    if (key && !tags.has(key)) tags.set(key, tag.trim());
  }

  return {
    id: lesson.id ?? '',
    title,
    kind: kindOf(lesson),
    createdAt: lesson.createdAt ?? '',
    tokens,
    titleTokens,
    labels,
    tags,
  };
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** Jaccard overlap of two token sets: shared words over the words either one used. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

function sharedTagCount(a: LessonSignature, b: LessonSignature): number {
  if (a.tags.size === 0 || b.tags.size === 0) return 0;
  let shared = 0;
  for (const key of a.tags.keys()) if (b.tags.has(key)) shared += 1;
  return shared;
}

/** The tags two lessons hold in common, as the first one spelled them, sorted for display. */
function sharedTagsBetween(a: LessonSignature, b: LessonSignature): string[] {
  if (a.tags.size === 0 || b.tags.size === 0) return [];
  const out: string[] = [];
  for (const [key, label] of a.tags) if (b.tags.has(key)) out.push(label);
  return out.sort((x, y) => x.localeCompare(y));
}

/**
 * How alike two lessons read, 0-1.
 *
 * The title is the strongest signal that two notes are about the same thing, so title agreement
 * is scaled up and taken alongside overall body agreement rather than averaged with it — a short
 * title is only a few words, and averaging would let a long, generic note dilute an almost
 * verbatim title match.
 */
function similarity(a: LessonSignature, b: LessonSignature): number {
  const body = jaccard(a.tokens, b.tokens);
  const title = jaccard(a.titleTokens, b.titleTokens);
  return Math.max(body, title * 0.95);
}

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

/** How strongly a finding repeats. */
export type LessonRecurrenceLevel = 'emerging' | 'recurring' | 'chronic';

/** The count at which a repeat stops being a coincidence and becomes a pattern. */
export const RECURRING_REPEAT_COUNT = 3;

/** The count at which a pattern has clearly become the trader's standing problem. */
export const CHRONIC_REPEAT_COUNT = 5;

/** Defaults, each overridable so a caller (or a test) can tune the reading. */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.45;
export const DEFAULT_MIN_SHARED_TAGS = 2;
export const DEFAULT_MIN_CLUSTER_SIZE = 2;
export const DEFAULT_MIN_TERM_LESSONS = 2;
export const DEFAULT_MAX_CLUSTERS = 12;
export const DEFAULT_MAX_TERMS = 24;

/** How many near-matches the save-time warning names before it stops listing them. */
export const DEFAULT_MAX_MATCHES = 3;

export interface LessonRecurrenceOptions {
  /** Jaccard similarity at or above which two lessons are treated as the same finding. */
  similarityThreshold?: number;
  /** Distinct tags in common that link two lessons regardless of how they are worded. */
  minSharedTags?: number;
  /** The smallest group reported as a repeat. Two is the floor by definition. */
  minClusterSize?: number;
  /** How many distinct lessons a term must appear in to be listed as recurring. */
  minTermLessons?: number;
  /** Cap on returned clusters and terms, strongest first. */
  maxClusters?: number;
  maxTerms?: number;
}

/** A group of lessons that keep saying the same thing. */
export interface LessonRecurrenceCluster {
  /** Stable id — the earliest member's id, which is unique to the cluster. */
  id: string;
  /** The lesson the finding was first written down in. */
  representativeId: string;
  representativeTitle: string;
  /** Member lesson ids, earliest first. */
  lessonIds: string[];
  /** How many lessons make up the repeat. */
  count: number;
  /** YYYY-MM-DD of the first and last member, or '' when a date cannot be read. */
  firstDate: string;
  lastDate: string;
  /** Whole days from the first to the last member. 0 for lessons written the same day. */
  spanDays: number;
  /** Every kind present among the members, first seen first. */
  kinds: LessonKind[];
  /** The most common kind among the members. */
  dominantKind: LessonKind;
  /** Tags shared by two or more members, as the trader spelled them. */
  sharedTags: string[];
  level: LessonRecurrenceLevel;
}

/** A word the trader keeps reaching for across lessons. */
export interface LessonRecurrenceTerm {
  /** The stemmed token, as it is actually compared. */
  term: string;
  /** The word as the trader spells it, for a readable label. */
  label: string;
  /** How many distinct lessons contain it. */
  lessons: number;
  /** Those lesson ids, earliest first. */
  lessonIds: string[];
}

export interface LessonRecurrenceReport {
  /** How many lessons were read. */
  total: number;
  /** How many lessons belong to at least one reported cluster. */
  clusteredLessons: number;
  /** Groups of lessons that keep repeating, strongest first. */
  clusters: LessonRecurrenceCluster[];
  /** Words that recur across lessons, the most-shared first. */
  terms: LessonRecurrenceTerm[];
  /** True when there is no repetition to show — the panel can stay out of the way. */
  empty: boolean;
}

// ---------------------------------------------------------------------------
// Building the report
// ---------------------------------------------------------------------------

function msOf(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function dateOf(iso: string | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
  return iso.slice(0, 10);
}

function levelFor(count: number): LessonRecurrenceLevel {
  if (count >= CHRONIC_REPEAT_COUNT) return 'chronic';
  if (count >= RECURRING_REPEAT_COUNT) return 'recurring';
  return 'emerging';
}

/** The order every group reads in: earliest first, ties broken by id so it is never arbitrary. */
function sortMembers(members: LessonSignature[]): LessonSignature[] {
  return [...members].sort((a, b) => {
    const byDate = (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
    return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
  });
}

function toCluster(members: LessonSignature[]): LessonRecurrenceCluster | null {
  const ordered = sortMembers(members);
  const representative = ordered[0];
  if (!representative) return null;

  const kinds: LessonKind[] = [];
  const kindCounts = new Map<LessonKind, number>();
  for (const member of ordered) {
    kindCounts.set(member.kind, (kindCounts.get(member.kind) ?? 0) + 1);
    if (!kinds.includes(member.kind)) kinds.push(member.kind);
  }

  let dominantKind = ordered[0].kind;
  let dominantCount = 0;
  for (const kind of kinds) {
    const count = kindCounts.get(kind) ?? 0;
    // Ties keep the kind that appeared first among the members, so this is deterministic.
    if (count > dominantCount) {
      dominantCount = count;
      dominantKind = kind;
    }
  }

  // Tags held in common by two or more members, in the trader's own spelling from the earliest
  // member that carries each one.
  const sharedTags: string[] = [];
  const seen = new Map<string, number>();
  for (const member of ordered) {
    for (const key of member.tags.keys()) seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const member of ordered) {
    for (const [key, label] of member.tags) {
      if ((seen.get(key) ?? 0) >= 2 && !sharedTags.includes(label)) sharedTags.push(label);
    }
  }
  sharedTags.sort((a, b) => a.localeCompare(b));

  const firstMs = msOf(representative.createdAt);
  const lastMs = msOf(ordered[ordered.length - 1].createdAt);
  const spanDays =
    firstMs !== null && lastMs !== null
      ? Math.max(0, Math.round((lastMs - firstMs) / 86_400_000))
      : 0;

  return {
    id: `lesson-repeat-${representative.id}`,
    representativeId: representative.id,
    representativeTitle: representative.title,
    lessonIds: ordered.map((member) => member.id),
    count: ordered.length,
    firstDate: dateOf(representative.createdAt),
    lastDate: dateOf(ordered[ordered.length - 1].createdAt),
    spanDays,
    kinds,
    dominantKind,
    sharedTags,
    level: levelFor(ordered.length),
  };
}

/** Groups the indices of lessons that repeat, using union-find over the linking rules. */
function clusterIndices(signatures: LessonSignature[], options: Required<LessonRecurrenceOptions>): number[][] {
  const parent = signatures.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    // Path compression, so a long chain of near-duplicates resolves in one step afterwards.
    let walk = index;
    while (parent[walk] !== root) {
      const next = parent[walk];
      parent[walk] = root;
      walk = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  const isLinked = (a: LessonSignature, b: LessonSignature): boolean => {
    if (sharedTagCount(a, b) >= options.minSharedTags) return true;
    return similarity(a, b) >= options.similarityThreshold;
  };

  for (let i = 0; i < signatures.length; i += 1) {
    for (let j = i + 1; j < signatures.length; j += 1) {
      if (isLinked(signatures[i], signatures[j])) union(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < signatures.length; i += 1) {
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(i);
    else groups.set(root, [i]);
  }
  return [...groups.values()];
}

function buildTerms(
  signatures: LessonSignature[],
  options: Required<LessonRecurrenceOptions>
): LessonRecurrenceTerm[] {
  const byTerm = new Map<string, { label: string; ids: string[] }>();
  for (const signature of signatures) {
    for (const token of signature.tokens) {
      const entry = byTerm.get(token);
      if (entry) {
        entry.ids.push(signature.id);
      } else {
        // Signatures run oldest first, so the first label seen is the earliest spelling.
        byTerm.set(token, { label: signature.labels.get(token) ?? token, ids: [signature.id] });
      }
    }
  }

  const terms: LessonRecurrenceTerm[] = [];
  for (const [term, { label, ids }] of byTerm) {
    if (ids.length < options.minTermLessons) continue;
    // Signatures were sorted oldest first before this ran, so the ids already read that way.
    terms.push({ term, label, lessons: ids.length, lessonIds: [...ids] });
  }

  // Most-shared first; the alphabetical tie-break keeps equal counts in a stable order.
  terms.sort((a, b) => (b.lessons - a.lessons) || a.term.localeCompare(b.term));
  return terms.slice(0, options.maxTerms);
}

function withDefaults(options: LessonRecurrenceOptions): Required<LessonRecurrenceOptions> {
  return {
    similarityThreshold: options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD,
    minSharedTags: options.minSharedTags ?? DEFAULT_MIN_SHARED_TAGS,
    minClusterSize: Math.max(2, options.minClusterSize ?? DEFAULT_MIN_CLUSTER_SIZE),
    minTermLessons: Math.max(2, options.minTermLessons ?? DEFAULT_MIN_TERM_LESSONS),
    maxClusters: options.maxClusters ?? DEFAULT_MAX_CLUSTERS,
    maxTerms: options.maxTerms ?? DEFAULT_MAX_TERMS,
  };
}

/**
 * Reads a library of lessons and reports what repeats.
 *
 * Deterministic and side-effect free: the same lessons always produce the same clusters in the
 * same order, which is what lets the panel re-render on every keystroke without the findings
 * shuffling underneath the trader. A library too small or too varied to have any repetition
 * comes back `empty` rather than with a padded-out list.
 */
export function findLessonRecurrence(
  lessons: Lesson[],
  options: LessonRecurrenceOptions = {}
): LessonRecurrenceReport {
  const resolved = withDefaults(options);
  // Read the lessons oldest first, so every id list this report hands back is chronological
  // without each caller having to sort it.
  const signatures = sortMembers(lessons.map(signatureOf));

  const clusters: LessonRecurrenceCluster[] = [];
  for (const indices of clusterIndices(signatures, resolved)) {
    if (indices.length < resolved.minClusterSize) continue;
    const cluster = toCluster(indices.map((index) => signatures[index]));
    if (cluster) clusters.push(cluster);
  }

  clusters.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const byLast = b.lastDate.localeCompare(a.lastDate);
    if (byLast !== 0) return byLast;
    return a.representativeId.localeCompare(b.representativeId);
  });

  const reported = clusters.slice(0, resolved.maxClusters);
  const terms = buildTerms(signatures, resolved);

  return {
    total: lessons.length,
    clusteredLessons: reported.reduce((sum, cluster) => sum + cluster.count, 0),
    clusters: reported,
    terms,
    empty: reported.length === 0 && terms.length === 0,
  };
}

/**
 * A lookup from lesson id to the size of the repeat it belongs to.
 *
 * Only lessons in a reported cluster appear, so a card can ask "does this one repeat?" without
 * walking the cluster list itself. A lesson in the library but not in any repeat is absent
 * rather than present with a count of 1 — the caller spells "no repeat" as a missing key.
 */
export function lessonRepeatCounts(
  report: LessonRecurrenceReport
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const cluster of report.clusters) {
    for (const lessonId of cluster.lessonIds) counts[lessonId] = cluster.count;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// The save-time read
// ---------------------------------------------------------------------------

/** Why a lesson being written looks like one already in the library. */
export type LessonSimilarityReason = 'wording' | 'tags';

/** One existing lesson a lesson being written reads like. */
export interface LessonSimilarityMatch {
  /** The lesson already in the library. */
  lesson: Lesson;
  /** How alike the wording is, 0-1. */
  similarity: number;
  /** Tags the two have in common, as the candidate spelled them. */
  sharedTags: string[];
  /** 'wording' when the notes read alike; 'tags' when only the filing links them. */
  reason: LessonSimilarityReason;
}

export interface LessonSimilarityOptions {
  /** Jaccard similarity at or above which the wording is treated as the same finding. */
  similarityThreshold?: number;
  /** Distinct tags in common that link two lessons regardless of how they are worded. */
  minSharedTags?: number;
  /** Cap on returned matches, strongest first. */
  maxMatches?: number;
}

/**
 * Finds the lessons a draft is about to repeat.
 *
 * This is the same comparison the repetition panel makes, run at the moment a note is written
 * instead of afterwards: it can say "you have already written this down" while the trader still
 * has the words in front of them. It only reports — the caller decides whether to warn, and the
 * trader always gets the last word, because a note that reads like an old one can still be a
 * genuinely new observation that wants its own entry.
 *
 * An edit compares against everything except itself, so re-saving an untouched lesson is never a
 * duplicate of the version it replaces. Matches come back strongest first: the closest wording
 * leads, then the most tags in common, then the most recent, with the id as a final stable
 * tie-break so the same draft always produces the same warning.
 */
export function findSimilarLessons(
  candidate: LessonInput,
  lessons: Lesson[],
  options: LessonSimilarityOptions = {}
): LessonSimilarityMatch[] {
  const threshold = options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const minSharedTags = options.minSharedTags ?? DEFAULT_MIN_SHARED_TAGS;
  const maxMatches = Math.max(1, options.maxMatches ?? DEFAULT_MAX_MATCHES);
  const candidateSignature = signatureOf(candidate);

  const matches: LessonSimilarityMatch[] = [];
  for (const lesson of lessons) {
    // A lesson is never a near-match of itself.
    if (candidate.id && lesson.id === candidate.id) continue;
    const other = signatureOf(lesson);
    const score = similarity(candidateSignature, other);
    const sharedTags = sharedTagsBetween(candidateSignature, other);
    const byWording = score >= threshold;
    const byTags = sharedTags.length >= minSharedTags;
    if (!byWording && !byTags) continue;
    matches.push({
      lesson,
      similarity: score,
      sharedTags,
      reason: byWording ? 'wording' : 'tags',
    });
  }

  matches.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    if (b.sharedTags.length !== a.sharedTags.length) {
      return b.sharedTags.length - a.sharedTags.length;
    }
    const byDate = (b.lesson.createdAt ?? '').localeCompare(a.lesson.createdAt ?? '');
    if (byDate !== 0) return byDate;
    return a.lesson.id.localeCompare(b.lesson.id);
  });

  return matches.slice(0, maxMatches);
}
