/**
 * Doing the journal import: reading the pictures, storing them, and writing the records.
 *
 * `journal-import.ts` decides what should come in and what a brought-in picture may claim. This
 * module is the part that touches the world, and it is separate for that reason: the rules can be
 * tested without a bucket, and the network work can be tested without re-deriving the rules.
 *
 * Three behaviours are carried over from the memory picker, because an imported picture has to end
 * up in exactly the same state as a picked one or the library would hold two kinds of row that
 * disagree about what they mean:
 *
 *   1. **A failed upload never costs the trader the picture.** When there is no cloud, or an upload
 *      fails, the compressed copy is kept inline in the journal instead. The picture is then not
 *      searchable until the "move and index" run uploads it, which the screen already says.
 *   2. **Consent decides whether it is queued for indexing, not whether it is stored.** Importing is
 *      the trader's own file moving between two places they own; sending it to a model is a separate
 *      decision, and this never makes it.
 *   3. **Nothing is claimed that did not happen.** A picture that could not be read is reported, by
 *      trade, with the reason — never silently dropped, and never recorded as if it had arrived.
 *
 * The role is fixed at `context` by `importedMemoryImage` and cannot be set from here, which is what
 * makes "an import can never create a search candidate" a property of the code rather than a rule
 * somebody has to remember.
 */

import type { Instrument, MemoryImage, Trade, TradingObservation } from '../../types';
import { instrumentSymbol } from '../trading/instruments';
import { MAX_COACH_IMAGE_DATA_CHARS } from '../ai/coach-images';
import { readBlobAsDataUrl } from '../utils/image-utils';
import {
  importedMemoryImage,
  observationFromJournalTrade,
  type JournalImportPlan,
} from './journal-import';
import { readImageDataUrl, uploadMemoryImage } from './storage';

export interface JournalImportIo {
  /** Resolves a journal reference into bytes the storage layer accepts. */
  read: (source: string) => Promise<{ dataUrl: string } | { reason: string }>;
  /** Uploads one inline picture to the private bucket. */
  upload: (input: {
    userId: string;
    observationId: string;
    imageId: string;
    dataUrl: string;
  }) => Promise<{ storagePath: string; checksum: string | null }>;
}

/**
 * The bytes behind one journal reference.
 *
 * An inline screenshot is already the shape everything downstream wants, so it is passed straight
 * through after a size check. A picture in the media bucket is downloaded and turned back into a
 * data URL, because the private uploader and the embedding endpoint both take inline images. Every
 * failure is described in the trader's terms: what was wrong with *this* picture, not what a fetch
 * said.
 */
export async function readJournalImage(
  source: string
): Promise<{ dataUrl: string } | { reason: string }> {
  if (source.startsWith('data:image/')) {
    if (!readImageDataUrl(source)) {
      return { reason: 'That reference is not a readable image.' };
    }
    if (source.length > MAX_COACH_IMAGE_DATA_CHARS) {
      return {
        reason:
          'This screenshot is larger than the embedding model accepts, so it was left where it is. ' +
          'Compress it, or keep a smaller crop of the chart.',
      };
    }
    return { dataUrl: source };
  }

  if (!/^https?:\/\//i.test(source)) {
    return { reason: 'This attachment is not something that can be kept as a picture.' };
  }

  try {
    const response = await fetch(source);
    if (!response.ok) {
      return {
        reason: `This screenshot could not be downloaded (${response.status}), so it was left where it is.`,
      };
    }
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) {
      return { reason: 'This attachment is not an image, so it was left where it is.' };
    }
    const dataUrl = await readBlobAsDataUrl(blob);
    if (!dataUrl) {
      return { reason: 'This screenshot could not be turned into something that can be stored.' };
    }
    if (dataUrl.length > MAX_COACH_IMAGE_DATA_CHARS) {
      return {
        reason:
          'This screenshot is larger than the embedding model accepts, so it was left where it is.',
      };
    }
    return { dataUrl };
  } catch {
    return {
      reason: 'This screenshot could not be downloaded, so it was left where it is. It is not lost.',
    };
  }
}

/** One picture that did not make it, with the reason and whether it was kept anyway. */
export interface JournalImportFailure {
  tradeId: string;
  imageId: string;
  reason: string;
  /**
   * True when the picture WAS brought in, but only into the journal's own inline copy.
   *
   * Kept separate from a failed import on purpose: a picture stored in the browser is usable and
   * visible, and reporting it as "not imported" would send the trader looking for something that is
   * already on their screen.
   */
  keptInline: boolean;
}

export interface JournalImportResult {
  /**
   * The records to persist: one per trade that gained at least one picture.
   *
   * Returned rather than written, because this module does not own the journal. The caller saves
   * them, which is what stops a successful import from disappearing on the next reload.
   */
  observations: TradingObservation[];
  /** How many trades got a brand-new record, and how many had pictures added to an existing one. */
  created: number;
  updated: number;
  /** How many pictures were stored. */
  imported: number;
  failures: JournalImportFailure[];
  /** True when the run stopped early, in which case what it did do is still in `observations`. */
  cancelled: boolean;
}

export interface JournalImportRequest {
  plan: JournalImportPlan;
  trades: readonly Trade[];
  observations: readonly TradingObservation[];
  instruments: readonly Instrument[];
  userId: string;
  timezone: string;
  consent: boolean;
  /** False in a local-only build, where there is no bucket and pictures stay inline. */
  cloudEnabled: boolean;
  /** Overridable so the whole import can be driven in a test with no bucket and no network. */
  io?: Partial<JournalImportIo>;
  signal?: AbortSignal;
  /** Injectable so the records' timestamps can be asserted. */
  now?: () => Date;
}

/** True when the run was asked to stop. Checked between pictures, so a stop costs one picture. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return Boolean(signal?.aborted);
}

export async function importJournalScreenshots(
  request: JournalImportRequest
): Promise<JournalImportResult> {
  const read = request.io?.read ?? readJournalImage;
  const upload = request.io?.upload ?? uploadMemoryImage;
  const now = () => (request.now ? request.now() : new Date());

  const tradeById = new Map<string, Trade>();
  for (const trade of request.trades) tradeById.set(trade.id, trade);
  const observationById = new Map<string, TradingObservation>();
  for (const observation of request.observations) observationById.set(observation.id, observation);

  const observations: TradingObservation[] = [];
  const failures: JournalImportFailure[] = [];
  let created = 0;
  let updated = 0;
  let imported = 0;
  let cancelled = false;

  for (const candidate of request.plan.candidates) {
    if (isAborted(request.signal)) {
      cancelled = true;
      break;
    }

    const trade = tradeById.get(candidate.tradeId);
    if (!trade) {
      // The plan came from a list of trades that no longer holds this one — a deletion between the
      // two. Reporting it is the honest answer: the plan's own id would otherwise be turned into a
      // record for a trade that no longer exists.
      for (const image of candidate.images) {
        failures.push({
          tradeId: candidate.tradeId,
          imageId: image.imageId,
          reason: 'That trade is no longer in the journal, so its pictures were left alone.',
          keptInline: false,
        });
      }
      continue;
    }

    const existing = observationById.get(candidate.observationId);
    const alreadyThere = new Set((existing?.images ?? []).map((image) => image.id));
    const images: MemoryImage[] = [];

    for (const image of candidate.images) {
      if (isAborted(request.signal)) {
        cancelled = true;
        break;
      }
      // The planner already excludes these; the guard is here so a hand-built plan cannot write a
      // second row for a picture the record already holds.
      if (alreadyThere.has(image.imageId)) continue;

      const picture = await read(image.source);
      if ('reason' in picture) {
        failures.push({
          tradeId: candidate.tradeId,
          imageId: image.imageId,
          reason: picture.reason,
          keptInline: false,
        });
        continue;
      }

      let storagePath: string | undefined;
      let checksum: string | null = null;
      let dataUrl: string | undefined = picture.dataUrl;

      if (request.cloudEnabled) {
        try {
          const uploaded = await upload({
            userId: request.userId,
            observationId: candidate.observationId,
            imageId: image.imageId,
            dataUrl: picture.dataUrl,
          });
          storagePath = uploaded.storagePath;
          checksum = uploaded.checksum;
          // Dropped only now that the object is confirmed readable and its path is in hand — the
          // same rule the picker follows, for the same reason.
          dataUrl = undefined;
        } catch (error) {
          failures.push({
            tradeId: candidate.tradeId,
            imageId: image.imageId,
            reason:
              error instanceof Error
                ? `Kept in this browser instead of your private storage: ${error.message}`
                : 'Kept in this browser instead of your private storage.',
            keptInline: true,
          });
        }
      }

      images.push(
        importedMemoryImage({
          imageId: image.imageId,
          observationId: candidate.observationId,
          storagePath,
          dataUrl,
          checksum,
          mimeType: readImageDataUrl(picture.dataUrl)?.mimeType,
          consent: request.consent,
          now: now(),
        })
      );
      imported += 1;
    }

    if (images.length === 0) continue;

    // One instant for the whole record, so a clock that advances between calls cannot leave the
    // record's own timestamp disagreeing with the pictures it holds.
    const at = now();
    if (existing) {
      observations.push({
        ...existing,
        images: [...(existing.images ?? []), ...images],
        updatedAt: at.toISOString(),
      });
      updated += 1;
    } else {
      observations.push({
        ...observationFromJournalTrade({
          candidate,
          trade,
          userId: request.userId,
          timezone: request.timezone,
          symbol: instrumentSymbol([...request.instruments], trade.instrumentId),
          consent: request.consent,
          now: at,
        }),
        images,
      });
      created += 1;
    }

    if (cancelled) break;
  }

  return { observations, created, updated, imported, failures, cancelled };
}
