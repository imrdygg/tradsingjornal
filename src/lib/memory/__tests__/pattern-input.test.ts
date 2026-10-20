import { describe, it, expect } from 'vitest';
import type { MemoryImage, TradingObservation } from '../../../types';
import {
  buildSightingNotesFacts,
  countSightingNotes,
  hasSightingNote,
  MAX_SIGHTINGS_PER_READ,
  sightingNotes,
} from '../pattern-input';

function image(overrides: Partial<MemoryImage> = {}): MemoryImage {
  return {
    id: `img-${Math.random().toString(36).slice(2, 8)}`,
    observationId: 'obs-1',
    role: 'before-setup',
    indexStatus: 'pending',
    createdAt: '2026-10-01T13:45:02.000Z',
    updatedAt: '2026-10-01T13:45:02.000Z',
    ...overrides,
  };
}

function observation(overrides: Partial<TradingObservation> = {}): TradingObservation {
  return {
    id: 'obs-1',
    userId: 'u1',
    observedAt: '2026-10-01T13:45:00.000Z',
    observedAtSource: 'recorded',
    marketTimezone: 'America/New_York',
    instrumentId: 'mes',
    symbol: 'MES',
    images: [],
    createdAt: '2026-10-01T13:45:01.000Z',
    updatedAt: '2026-10-01T13:45:01.000Z',
    ...overrides,
  };
}

describe('sightingNotes', () => {
  it('keeps the notes in the order the pictures were attached', () => {
    const notes = sightingNotes(
      observation({
        images: [
          image({ note: 'Three-day view: the shelf is intact.' }),
          image({ note: '  Zoomed in: the third test is weaker.  ' }),
        ],
      })
    );

    expect(notes).toEqual(['Three-day view: the shelf is intact.', 'Zoomed in: the third test is weaker.']);
  });

  it('drops a picture with no words or only whitespace', () => {
    expect(
      sightingNotes(observation({ images: [image({ note: '   ' }), image({ note: undefined })] }))
    ).toEqual([]);
  });
});

describe('buildSightingNotesFacts', () => {
  it('sends only sightings that carry a note, newest first', () => {
    const facts = buildSightingNotesFacts([
      observation({
        id: 'older',
        observedAt: '2026-09-28T13:00:00.000Z',
        images: [image({ note: 'Older note.' })],
      }),
      observation({
        id: 'silent',
        observedAt: '2026-10-02T13:00:00.000Z',
        images: [image({ note: undefined })],
      }),
      observation({
        id: 'newer',
        observedAt: '2026-10-03T13:00:00.000Z',
        timeframe: '15m',
        images: [image({ note: 'Newer note.' })],
      }),
    ]);

    expect(facts.total).toBe(2);
    expect(facts.listed).toBe(2);
    expect(facts.sightings.map((sighting) => sighting.date)).toEqual(['2026-10-03', '2026-09-28']);
    expect(facts.sightings[0]).toEqual({
      date: '2026-10-03',
      symbol: 'MES',
      timeframe: '15m',
      notes: ['Newer note.'],
    });
    // The day is taken from the stored instant, which is how the sighting is filed everywhere.
    expect(facts.sightings[1].timeframe).toBeUndefined();
  });

  it('caps at the newest N without pretending it read the whole library', () => {
    const observations = Array.from({ length: 5 }, (_, index) =>
      observation({
        id: `obs-${index}`,
        observedAt: `2026-10-0${index + 1}T13:00:00.000Z`,
        images: [image({ note: `Note ${index}.` })],
      })
    );

    const facts = buildSightingNotesFacts(observations, { maxSightings: 2 });

    expect(facts.total).toBe(5);
    expect(facts.listed).toBe(2);
    expect(facts.sightings.map((sighting) => sighting.notes[0])).toEqual(['Note 4.', 'Note 3.']);
  });

  it('defaults to the same ceiling the endpoint enforces', () => {
    expect(MAX_SIGHTINGS_PER_READ).toBe(40);
  });

  it('returns nothing to read when no sighting has a note', () => {
    const facts = buildSightingNotesFacts([observation({ images: [image()] })]);
    expect(facts).toEqual({ total: 0, listed: 0, sightings: [] });
  });
});

describe('counts used by the card', () => {
  it('counts notes across the whole library, not just the ones it would send', () => {
    const observations = [
      observation({ id: 'a', images: [image({ note: 'one' }), image({ note: 'two' })] }),
      observation({ id: 'b', images: [image({ note: 'three' })] }),
    ];

    expect(countSightingNotes(observations)).toBe(3);
    expect(hasSightingNote(observations[0])).toBe(true);
  });
});
