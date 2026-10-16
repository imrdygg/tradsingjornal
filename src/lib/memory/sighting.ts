/**
 * Turning the chart a search was made with into a sighting.
 *
 * This is the one case where the chart the trader held up against their library becomes part of it,
 * and it is deliberate rather than incidental. A search that comes back with nothing has told them
 * something real — *I have never kept this* — and a sighting is exactly what is missing. So the
 * screen offers it as a single action, on the failure, rather than recording every chart that was
 * ever used as a query.
 *
 * Three properties of the record this builds matter more than the rest:
 *
 *   1. **The picture is `before-setup`, which is matchable.** It is the chart in front of the trader
 *      when the setup was recognised, so `memory_match_images` may return it. Any later picture of
 *      the same event (`exit`, `after-setup`) is post-decision and deliberately never matchable —
 *      see `eligibility.ts`.
 *   2. **There is no outcome, and that is the correct state.** An outcome is what price did next, and
 *      it cannot be known at the moment of recording. `outcome` is left off entirely rather than set
 *      to `unknown`, so nothing downstream can mistake a placeholder for a reading.
 *   3. **It arrives `pending`, not indexed.** Recording is local and costs nothing; indexing is the
 *      step that uploads the picture and spends a model call, and it is gated on consent. A record
 *      that claimed to be searchable before that had happened would be lying about the one thing a
 *      search depends on.
 *
 * Pure and synchronous: the caller owns persistence, so the shape of what a recorded sighting is can
 * be tested without a store, a bucket or a session.
 */

import type { MemoryImage, MemorySearchFilters, TradingObservation } from '../../types';
import { readImageDataUrl } from './storage';

export interface SearchChartSightingInput {
  userId: string;
  timezone: string;
  /** The compressed chart that was searched with. */
  dataUrl: string;
  /**
   * The filters the search was running under.
   *
   * Carried onto the record because they are what the trader was looking at: having narrowed to MES
   * on the 5-minute chart, the sighting they record from that screen describes that same chart. Each
   * one is copied only when it is actually set, so nothing is invented for a search that was not
   * narrowed at all.
   */
  filters?: MemorySearchFilters;
  /** Injectable so the record's timestamps can be asserted. */
  now?: Date;
}

/** A collision-resistant id, in the shape the rest of the memory records use. */
function newSightingId(now: Date): string {
  return `obs-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Builds the sighting for a searched chart.
 *
 * Throws when the chart is not an inline image, because `memory_images.storage_path` is `not null`
 * and an unreadable picture cannot be uploaded, so there would be nothing to store. Reporting that is
 * the caller's job: a sighting recorded without its picture would look like success and be useless.
 */
export function sightingFromSearchChart(input: SearchChartSightingInput): TradingObservation {
  const parts = readImageDataUrl(input.dataUrl);
  if (!parts) {
    throw new Error(
      'That chart is not an inline image, so it cannot be kept as a sighting. Record the sighting ' +
        'from the library and attach the picture there.'
    );
  }

  const now = input.now ?? new Date();
  const at = now.toISOString();
  const id = newSightingId(now);

  const image: MemoryImage = {
    id: `${id}-before`,
    observationId: id,
    role: 'before-setup',
    dataUrl: input.dataUrl,
    mimeType: parts.mimeType,
    // Not indexed, and NOT claimable as indexed: the upload and the embedding both happen later,
    // under the consent switch, and the library reports this picture as waiting until they do.
    indexStatus: 'pending',
    createdAt: at,
    updatedAt: at,
  };

  const filters = input.filters ?? {};

  return {
    id,
    userId: input.userId,
    observedAt: at,
    // The trader is recording this as they look at it, so the time is the decision moment and a
    // replay may use it. It is not an upload time pretending to be one.
    observedAtSource: 'recorded',
    marketTimezone: input.timezone,
    // The symbol stands in for both fields, which is what `observationFromRow` does for a record read
    // back off a row: the table stores the searchable symbol and no local instrument id exists there.
    instrumentId: filters.instrument ?? '',
    symbol: filters.instrument ?? '',
    timeframe: filters.timeframe,
    session: filters.session,
    setupName: filters.setupName,
    // No `setupId`: the filter names a setup by its name, and guessing an id would silently attach
    // this sighting to whatever setup happened to share that name.
    images: [image],
    // No `outcome`, no `notes`, no linked trade. All three are things the trader has not said yet.
    createdAt: at,
    updatedAt: at,
  };
}
