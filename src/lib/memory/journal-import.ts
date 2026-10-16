/**
 * Bringing the journal's own screenshots into the memory library.
 *
 * Everything in the memory subsystem reads ONE collection: the trader's recorded sightings. A
 * screenshot attached to a trade, a session review or a lesson belongs to that record, lives in the
 * journal snapshot or the media bucket, and is invisible to a similarity search. That boundary is
 * deliberate — but on its own it produces an empty library beside a journal full of charts, which
 * the trader has every reason to read as a broken feature rather than as a scope decision.
 *
 * So the pictures can be brought across. What they may NOT be brought across as is *matchable*, and
 * that is the whole difficulty. A chart attached to a trade says nothing about whether it was taken
 * before the decision or after it: the same field holds the chart the trader was watching at the
 * entry and the chart they screenshotted once the trade was closed. Only `before-setup` and `entry`
 * may ever be matched against (see `eligibility.ts`) — an unlabelled picture cannot be *shown* to be
 * pre-decision, and a boundary that leans permissive is not a boundary.
 *
 * So an imported picture arrives `context`: stored, readable, and not searchable. It is a card in
 * the library asking one question — *what does this show?* — and the trader answers per picture by
 * promoting the ones that were in front of them at the decision. Only then does it become a
 * candidate. Nothing here guesses, and nothing here can be talked into guessing: the role the
 * planner writes is fixed, and `promoteJournalImage` is the single path out of it.
 *
 * This module is pure. It plans, it builds and it promotes; it reads no bucket, writes no journal
 * and touches no network. `journal-import-runner.ts` is what uploads.
 */

import type { MemoryImage, Trade, TradingObservation } from '../../types';
import { isPreDecisionRole } from './eligibility';

/** The role an imported picture arrives with: kept, readable, and never a search candidate. */
export const IMPORTED_IMAGE_ROLE: MemoryImage['role'] = 'context';

/**
 * How many pictures one press may bring in.
 *
 * Every picture is a read, a possible download and a possible upload, so the work is paged rather
 * than fired off in one go: a journal with four hundred screenshots should not turn one click into
 * four hundred requests with no way to see or stop the middle of it. The panel says what is left,
 * and pressing again takes the next page.
 */
export const JOURNAL_IMPORT_PAGE_SIZE = 24;

/** Why one journal picture was not planned for import. Each is reported separately. */
export type JournalImportSkipReason =
  /** The library already holds this exact picture, so importing it again would duplicate the row. */
  | 'already-imported'
  /** Its trade has no usable entry time, so there is nothing to place the picture at. */
  | 'no-decision-time'
  /** A clip, a file path, or anything that is neither an inline image nor an http(s) URL. */
  | 'unreadable-source';

/** One picture this plan will bring in, and the id its library row will carry. */
export interface JournalImportImage {
  /** The journal's own reference: an inline data URL, or a URL in the media bucket. */
  source: string;
  /** Deterministic, so the same picture imported twice cannot become two rows. */
  imageId: string;
}

/** One trade's worth of work: its pictures, and where the record for them goes. */
export interface JournalImportCandidate {
  tradeId: string;
  observationId: string;
  /**
   * True when the library already has a sighting linked to this trade.
   *
   * Its pictures are then ADDED to that record rather than made into a second one, because two
   * records for one trade is how a library stops being readable: the same event, once as the
   * trader's own sighting and once as an import.
   */
  existingObservation: boolean;
  /** The trade's own entry moment, which is where the observation is placed. */
  observedAt: string;
  instrumentId: string;
  images: JournalImportImage[];
}

export interface JournalImportPlan {
  /** This page's work. Empty is a valid answer: it means there is nothing left to bring in. */
  candidates: JournalImportCandidate[];
  /** The same exclusions counted by reason. Every key is always present, including zeros. */
  skippedByReason: Record<JournalImportSkipReason, number>;
  /** Every picture string on every trade, so the rest of the plan can be read against it. */
  totalJournalImages: number;
  /** How many trades carry at least one picture. */
  tradesWithImages: number;
  /** How many pictures the WHOLE backlog holds, not only this page. */
  imagesToImport: number;
  /** True when candidates continue past this page. */
  truncated: boolean;
}

export interface JournalImportInput {
  trades: readonly Trade[];
  observations: readonly TradingObservation[];
  pageSize?: number;
}

/** A trade id reduced to something safe to put in an object path. */
function tradeKey(tradeId: string): string {
  // Ids are app-generated and tame. This keeps that a fact rather than an assumption: the memory
  // storage path is built from this, and the storage policy reads its first folder as the owner, so
  // a stray slash would move the object out from under the policy protecting it. An id that fails
  // the test is replaced by a hash of itself rather than stripped, because two ids that differ only
  // in punctuation must not collide.
  if (/^[A-Za-z0-9._-]+$/.test(tradeId)) return tradeId;
  return `h${hashSource(tradeId)}`;
}

/**
 * A stable 64-bit-ish hash of a picture's source string.
 *
 * Two runs of FNV-1a over the same string, with different seeds and a position term, concatenated.
 * This is an identity, not a security claim: it exists so the same picture always maps to the same
 * row id, which is what makes the import idempotent and what lets the planner answer "already in the
 * library" without reading a single byte.
 */
function hashSource(source: string): string {
  let a = 0x811c9dc5;
  let b = 0x7b1d9e37;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/**
 * The observation a trade's pictures belong to.
 *
 * Derived from the trade id rather than generated fresh, so a plan, a resumed plan and a library
 * that already holds the import all agree on which record is which.
 */
export function journalObservationId(tradeId: string): string {
  return `obs-journal-${tradeKey(tradeId)}`;
}

/** The library row id for one journal picture of one trade. */
export function journalImageId(tradeId: string, source: string): string {
  return `img-journal-${tradeKey(tradeId)}-${hashSource(source)}`;
}

/**
 * Whether a journal reference is something this import can actually fetch.
 *
 * Total, and it returns false rather than throwing, because it runs over whatever the journal holds
 * — including entries written by another device or an older build. A clip is excluded here rather
 * than left to fail later: `Trade.images` holds screenshots, but the same shape is used for lesson
 * media, and a `.mp4` that reached a trade would otherwise be downloaded in full before anyone
 * discovered it was not a picture.
 */
export function isImportableJournalImage(source: string | undefined | null): boolean {
  if (!source || typeof source !== 'string') return false;
  if (source.startsWith('data:image/')) return true;
  if (!/^https?:\/\//i.test(source)) return false;
  return !/\.(mp4|mov|webm|m4v|avi)(\?|#|$)/i.test(source);
}

function clampPageSize(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return JOURNAL_IMPORT_PAGE_SIZE;
  return Math.max(1, Math.floor(value));
}

/**
 * Works out what an import would bring in, and what it would leave behind.
 *
 * Ordered by entry time so the sequence is stable: two plans of the same journal produce the same
 * pages, which is what lets the panel say "again for the rest" and mean it.
 */
export function planJournalImport(input: JournalImportInput): JournalImportPlan {
  const pageSize = clampPageSize(input.pageSize);

  const knownImageIds = new Set<string>();
  for (const observation of input.observations) {
    for (const image of observation.images ?? []) knownImageIds.add(image.id);
  }

  const observationByTrade = new Map<string, TradingObservation>();
  for (const observation of input.observations) {
    if (observation.linkedTradeId) observationByTrade.set(observation.linkedTradeId, observation);
  }

  const skippedByReason: Record<JournalImportSkipReason, number> = {
    'already-imported': 0,
    'no-decision-time': 0,
    'unreadable-source': 0,
  };

  const all: JournalImportCandidate[] = [];
  let totalJournalImages = 0;
  let tradesWithImages = 0;

  const ordered = [...input.trades].sort(
    (a, b) => (a.entryTime ?? '').localeCompare(b.entryTime ?? '') || a.id.localeCompare(b.id)
  );

  for (const trade of ordered) {
    const sources = trade.images ?? [];
    if (sources.length === 0) continue;
    tradesWithImages += 1;
    totalJournalImages += sources.length;

    // The trade's own entry moment. A picture attached to a trade has no timestamp of its own, and
    // the entry is the only instant the journal actually recorded for it — so it is the time the
    // observation is placed at, and it is a fact the trader entered rather than a guess. What is NOT
    // trusted about an import is the role, which is why the picture arrives unlabelled.
    const observedMs = trade.entryTime ? Date.parse(trade.entryTime) : Number.NaN;
    if (!Number.isFinite(observedMs)) {
      // No entry time is not a reason to invent one: an observation placed at an upload time would
      // silently drop the picture into a replay window it never belonged to.
      skippedByReason['no-decision-time'] += sources.length;
      continue;
    }

    const images: JournalImportImage[] = [];
    for (const source of sources) {
      if (!isImportableJournalImage(source)) {
        skippedByReason['unreadable-source'] += 1;
        continue;
      }
      const imageId = journalImageId(trade.id, source);
      // The same URL twice on one trade is one picture, and the same picture already in the library
      // is not work. Both are counted, because a plan that silently dropped them would make the
      // numbers on screen disagree with the journal.
      if (knownImageIds.has(imageId) || images.some((image) => image.imageId === imageId)) {
        skippedByReason['already-imported'] += 1;
        continue;
      }
      images.push({ source, imageId });
    }

    if (images.length === 0) continue;
    const existing = observationByTrade.get(trade.id);
    all.push({
      tradeId: trade.id,
      observationId: existing?.id ?? journalObservationId(trade.id),
      existingObservation: Boolean(existing),
      observedAt: new Date(observedMs).toISOString(),
      instrumentId: trade.instrumentId,
      images,
    });
  }

  const imagesToImport = all.reduce((sum, candidate) => sum + candidate.images.length, 0);
  const candidates = all.slice(0, pageSize);

  return {
    candidates,
    skippedByReason,
    totalJournalImages,
    tradesWithImages,
    imagesToImport,
    truncated: candidates.length < all.length,
  };
}

export interface JournalObservationInput {
  candidate: JournalImportCandidate;
  trade: Trade;
  userId: string;
  timezone: string;
  symbol: string;
  consent: boolean;
  /** Injectable so a record's timestamps can be asserted. */
  now?: Date;
}

/**
 * The sighting an imported trade becomes.
 *
 * Three things are deliberately absent, and each is a decision rather than an omission:
 *
 *   1. **No outcome.** The trade record holds entries, exits and P&L — the trader's *execution* —
 *      and an outcome is what the *market* did. Copying one from the other is the blending this
 *      subsystem keeps apart all the way down, and it would put a reading into the library that
 *      nobody ever made.
 *   2. **No notes, setup or direction from the trade's own words.** `setupName` is carried because it
 *      is a label the trade already carries and grouping on it is the trader's own grouping, but the
 *      entry reason is about the *trade* and is left to be read on the trade itself.
 *   3. **No embedding, and not queued as if one were coming.** The picture is `context`, which no
 *      indexing run will send, so its status follows consent the way every other unlabelled picture
 *      does and nothing claims a vector it cannot have.
 */
export function observationFromJournalTrade(input: JournalObservationInput): TradingObservation {
  const at = (input.now ?? new Date()).toISOString();
  const { candidate, trade } = input;

  return {
    id: candidate.observationId,
    userId: input.userId,
    linkedTradeId: trade.id,
    observedAt: candidate.observedAt,
    // The entry time is a moment the trader recorded, so it may be replayed against. The role is
    // the part that is unknown, and it is what `context` says.
    observedAtSource: 'recorded',
    marketTimezone: input.timezone,
    instrumentId: trade.instrumentId,
    symbol: input.symbol,
    session: trade.session,
    setupId: trade.setupId,
    setupName: trade.setupName,
    images: [],
    createdAt: at,
    updatedAt: at,
  };
}

export interface JournalMemoryImageInput {
  imageId: string;
  observationId: string;
  /** The stored form: a path in the private bucket, or an inline copy in a local-only journal. */
  storagePath?: string;
  dataUrl?: string;
  checksum?: string | null;
  mimeType?: string;
  consent: boolean;
  now?: Date;
}

/** One imported picture, in the only role an import may use. */
export function importedMemoryImage(input: JournalMemoryImageInput): MemoryImage {
  const at = (input.now ?? new Date()).toISOString();
  return {
    id: input.imageId,
    observationId: input.observationId,
    role: IMPORTED_IMAGE_ROLE,
    storagePath: input.storagePath,
    dataUrl: input.dataUrl,
    checksum: input.checksum ?? undefined,
    mimeType: input.mimeType,
    // Consent decides whether a LABELLED picture is queued, exactly as it does for a picked one.
    // For this one the status is inert either way until the role changes — see `promoteJournalImage`.
    indexStatus: input.consent ? 'pending' : 'skipped',
    createdAt: at,
    updatedAt: at,
  };
}

/** The pictures in a record that carry no label yet: imported, and not yet answered. */
export function unlabelledImages(observation: TradingObservation): MemoryImage[] {
  return (observation.images ?? []).filter((image) => image.role === IMPORTED_IMAGE_ROLE);
}

/** How many unlabelled pictures the whole library holds. */
export function countUnlabelledImages(observations: readonly TradingObservation[]): number {
  return observations.reduce((sum, observation) => sum + unlabelledImages(observation).length, 0);
}

/** True when this picture is waiting for the trader to say what it shows. */
export function isUnlabelledImage(image: MemoryImage): boolean {
  return image.role === IMPORTED_IMAGE_ROLE;
}

export interface PromoteJournalImageOptions {
  /** Whether the trader has consented to cloud image processing. Decides the picture's queue state. */
  consent: boolean;
  now?: Date;
}

/**
 * Answers the question an imported picture asks.
 *
 * The picture becomes `before-setup` — the one role that says "this was in front of me when I
 * decided" — and any other pre-decision picture in the same record stops being one, because a record
 * with two pictures that both claim to be the moment of decision has no way to say which the
 * library matched on. The swap is the honest reading of the act: the trader is pointing at the
 * picture and saying *this* is the one.
 *
 * Returns the record unchanged when the id is not in it or is already pre-decision, so the caller
 * can hand the result straight to `onSave` without guarding every path.
 */
export function promoteJournalImage(
  observation: TradingObservation,
  imageId: string,
  options: PromoteJournalImageOptions
): TradingObservation {
  const images = observation.images ?? [];
  const target = images.find((image) => image.id === imageId);
  if (!target || isPreDecisionRole(target.role)) return observation;

  const at = (options.now ?? new Date()).toISOString();
  const next: MemoryImage[] = images.map((image) => {
    if (image.id === imageId) {
      return {
        ...image,
        role: 'before-setup' as const,
        // A picture that was never eligible cannot already carry a current embedding, so this can
        // only ever move it onto the queue consent allows — never knock a completed one off it.
        indexStatus:
          image.indexStatus === 'completed' ? image.indexStatus : options.consent ? 'pending' : 'skipped',
        updatedAt: at,
      };
    }
    if (isPreDecisionRole(image.role)) {
      return { ...image, role: IMPORTED_IMAGE_ROLE, updatedAt: at };
    }
    return image;
  });

  return { ...observation, images: next, updatedAt: at };
}
