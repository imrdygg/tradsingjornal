import { describe, it, expect } from 'vitest';
import { buildCoachPlanPatch } from '../plan-coach';
import type { CoachPlanFields } from '../coach-types';
import type { Setup, TradingDay } from '../../../types';

/**
 * The applier both plan surfaces go through.
 *
 * A coach draft is written into a plan that the trader owns, so these cover the ways that
 * could go wrong: filling the wrong fields, blanking text the trader wrote, injecting a
 * setup the playbook cannot open, or touching a risk parameter the coach has no business
 * changing. Every case asserts what the patch does NOT carry as carefully as what it does.
 */

function makeDay(overrides: Partial<TradingDay> = {}): TradingDay {
  return {
    id: 'd1',
    userId: 'u1',
    tradeDate: '2026-09-18',
    status: 'active',
    riskMode: 'normal',
    normalLossLimit: 100,
    plannedLossLimit: 100,
    contractsPlanned: 2,
    primaryInstrument: 'MES',
    allowedSessions: ['Regular Session'],
    marketBias: 'neutral',
    watchedSetups: ['Engulfing'],
    importantLevels: [],
    waitingFor: 'Wait for the retest.',
    stayOutIf: 'Stay out in the first five minutes.',
    planChanges: [],
    createdAt: '2026-09-18T12:00:00.000Z',
    updatedAt: '2026-09-18T12:00:00.000Z',
    ...overrides,
  };
}

function makeSetup(name: string, id = name.toLowerCase()): Setup {
  return { id, name, active: true, createdAt: '2026-09-01T00:00:00.000Z' };
}

const SETUPS = [makeSetup('Breakout'), makeSetup('Engulfing'), makeSetup('VWAP Reclaim')];

function draftFor(overrides: Partial<CoachPlanFields> = {}): CoachPlanFields {
  return {
    bias: 'bullish',
    contracts: 3,
    setups: ['Breakout'],
    waitingFor: 'Wait for the prior close to hold on the pullback.',
    stayOutIf: 'Any break back under the overnight low.',
    levels: [{ price: 7744, label: 'day high' }],
    ...overrides,
  };
}

describe('buildCoachPlanPatch', () => {
  it('fills exactly the plan fields the draft spoke to', () => {
    const day = makeDay();
    const patch = buildCoachPlanPatch({ day, draft: draftFor(), setups: SETUPS });

    expect(patch.marketBias).toBe('bullish');
    expect(patch.contractsPlanned).toBe(3);
    expect(patch.watchedSetups).toEqual(['Breakout']);
    expect(patch.waitingFor).toBe('Wait for the prior close to hold on the pullback.');
    expect(patch.stayOutIf).toBe('Any break back under the overnight low.');
    expect(patch.importantLevels).toEqual([
      { id: expect.stringMatching(/^level-coach-/), tradingDayId: 'd1', price: 7744, label: 'day high' },
    ]);
  });

  it('never carries a risk parameter the coach does not own', () => {
    const day = makeDay({ plannedLossLimit: 250, normalLossLimit: 250, allowedSessions: ['Overnight'] });

    // The draft has no say over the loss limit, the sessions or the lock: a plan the coach
    // drafted must still be sized by the trader's own risk decisions.
    const patch = buildCoachPlanPatch({ day, draft: draftFor(), setups: SETUPS });

    expect(Object.keys(patch).sort()).toEqual([
      'contractsPlanned',
      'importantLevels',
      'marketBias',
      'stayOutIf',
      'waitingFor',
      'watchedSetups',
    ]);
    expect(patch).not.toHaveProperty('plannedLossLimit');
    expect(patch).not.toHaveProperty('allowedSessions');
    expect(patch).not.toHaveProperty('lockedAt');
  });

  it('keeps the setup names the playbook knows and drops the rest', () => {
    const day = makeDay();
    // A name the catalog does not hold (a hallucinated setup, or the trader's own wording)
    // must not be injected — the chips and the playbook could not open it.
    const patch = buildCoachPlanPatch({
      day,
      draft: draftFor({ setups: ['breakout', 'Liquidity Sweep Of The Prior Day Low'] }),
      setups: SETUPS,
    });

    expect(patch.watchedSetups).toEqual(['Breakout']);
  });

  it('leaves the trader’s setups alone when none of the suggested names match', () => {
    const day = makeDay();
    const patch = buildCoachPlanPatch({
      day,
      draft: draftFor({ setups: ['Something made up'] }),
      setups: SETUPS,
    });

    // Absent, not empty: the applier writing `[]` here would silently clear the plan.
    expect(patch).not.toHaveProperty('watchedSetups');
  });

  it('does not blank the written fields when the draft has nothing for them', () => {
    const day = makeDay();
    const patch = buildCoachPlanPatch({
      day,
      draft: draftFor({ waitingFor: '   ', stayOutIf: '' }),
      setups: SETUPS,
    });

    expect(patch).not.toHaveProperty('waitingFor');
    expect(patch).not.toHaveProperty('stayOutIf');
  });

  it('leaves the planned size alone when the coach did not size the day', () => {
    const day = makeDay({ contractsPlanned: 2 });
    // 0 is how a chart read says "no size from me", not a plan for no contracts.
    const patch = buildCoachPlanPatch({ day, draft: draftFor({ contracts: 0 }), setups: SETUPS });

    expect(patch).not.toHaveProperty('contractsPlanned');
    expect(day.contractsPlanned).toBe(2);
  });

  it('keeps the existing levels when the draft names none', () => {
    const day = makeDay({
      importantLevels: [{ id: 'l1', tradingDayId: 'd1', price: 7700, label: 'overnight low' }],
    });
    const patch = buildCoachPlanPatch({ day, draft: draftFor({ levels: [] }), setups: SETUPS });

    expect(patch).not.toHaveProperty('importantLevels');
    expect(day.importantLevels).toHaveLength(1);
  });

  it('changes the primary instrument only when the journal can price it', () => {
    const day = makeDay();

    // MES is a symbol the catalog holds, so the day follows the chart there.
    expect(
      buildCoachPlanPatch({ day, draft: draftFor(), setups: SETUPS, primaryInstrument: 'MES' })
        .primaryInstrument
    ).toBe('MES');

    // No instrument means the charted symbol is not one the app can size, so the day's
    // instrument must stay exactly where the trader set it.
    expect(
      buildCoachPlanPatch({ day, draft: draftFor(), setups: SETUPS })
    ).not.toHaveProperty('primaryInstrument');
  });

  it('gives each staged level its own id, even for the same price', () => {
    const day = makeDay();
    const patch = buildCoachPlanPatch({
      day,
      draft: draftFor({
        levels: [
          { price: 7744, label: 'day high' },
          { price: 7744, label: 'day high again' },
        ],
      }),
      setups: SETUPS,
    });

    const ids = (patch.importantLevels ?? []).map((level) => level.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(patch.importantLevels?.every((level) => level.tradingDayId === 'd1')).toBe(true);
  });
});
