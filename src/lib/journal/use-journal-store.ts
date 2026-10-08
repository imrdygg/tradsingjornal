import { useCallback, useMemo, useRef, useState } from 'react';
import { storage } from '../storage';
import type { StorageState } from '../storage';
import type { LevelRecord as MesLevelRecord } from '../mes/types';
import {
  ChartSearch,
  CoachPlan,
  DailyReview,
  FeedbackNote,
  Instrument,
  Lesson,
  LessonAcknowledgement,
  LevelOutlook,
  LevelTouch,
  MarkedLevel,
  MindsetNote,
  PatternStudy,
  SessionExtreme,
  Setup,
  Trade,
  TradingDay,
  UserProfile,
} from '../../types';

/**
 * The journal's own state: one entry per record type, plus the snapshot and the one way a
 * cloud copy is adopted.
 *
 * Lifted out of the shell so App composes views instead of owning eighteen pieces of data and
 * the sync plumbing at once. The state itself is unchanged — same initializers, same merge-on-
 * read catalogs — and every edit still goes through `lib/storage`, which is the only module
 * that touches storage keys.
 */
export function useJournalStore(userId: string) {
  const [profile, setProfile] = useState<UserProfile>(() => ({ ...storage.getProfile(), id: userId }));
  // The catalog is merged on read, so a contract added since this journal was created
  // arrives here instead of only on a fresh install.
  const [instruments, setInstruments] = useState<Instrument[]>(() =>
    storage.ensureInstrumentCatalog()
  );
  // The catalog is merged on read, so built-in setups added since this journal was created
  // arrive here instead of only on a fresh install.
  const [setups, setSetups] = useState<Setup[]>(() => storage.ensureSetupCatalog());
  const [tradingDays, setTradingDays] = useState<TradingDay[]>(() => storage.getTradingDays());
  const [trades, setTrades] = useState<Trade[]>(() => storage.getTrades());
  const [reviews, setReviews] = useState<DailyReview[]>(() => storage.getReviews());
  // The lesson the trader has accepted. Held in state so the banner and the review trend
  // react to the click, and persisted so a reload does not undo it.
  const [lessonAck, setLessonAck] = useState<LessonAcknowledgement | null>(() =>
    storage.getLessonAck()
  );
  const [patternStudies, setPatternStudies] = useState<PatternStudy[]>(() =>
    storage.getPatternStudies()
  );
  // The break-and-run journal. Held with the rest of the state so every touch is
  // persisted locally and carried to the cloud by the same debounced save.
  const [levelTouches, setLevelTouches] = useState<LevelTouch[]>(() =>
    storage.getLevelTouches()
  );
  // The levels the trader marked before any of them was touched. Held with the journal so a
  // marked line is saved and carried between devices by the same debounced write.
  const [markedLevels, setMarkedLevels] = useState<MarkedLevel[]>(() =>
    storage.getMarkedLevels()
  );
  // What the trader expects each instrument to do today, written beside the levels. Held with
  // the journal so a written lean is saved and carried between devices by the same write.
  const [levelOutlooks, setLevelOutlooks] = useState<LevelOutlook[]>(() =>
    storage.getLevelOutlooks()
  );
  // The MES Indicator Level Tracker's own record: one row per level per session, with what
  // price did at it. Held with the journal so a level is saved locally and carried to the
  // cloud by the same debounced write, and travels in the app's own backup.
  const [mesLevels, setMesLevels] = useState<MesLevelRecord[]>(() => storage.getMesLevels());
  // Where each session's extremes printed on the clock. The trader's own record, held with
  // the rest of the state so it is saved and synced by the same debounced write.
  const [sessionExtremes, setSessionExtremes] = useState<SessionExtreme[]>(() =>
    storage.getSessionExtremes()
  );
  // The saved picture searches: which charts the trader uploaded and what they matched.
  // Held with the rest of the state so it is saved and synced by the same debounced write.
  const [chartSearches, setChartSearches] = useState<ChartSearch[]>(() =>
    storage.getChartSearches()
  );
  // The lessons the trader wrote for themselves: their own notes, tags and media, held with
  // the rest of the state so they are saved and synced by the same debounced write.
  const [lessons, setLessons] = useState<Lesson[]>(() => storage.getLessons());
  // What the trader was thinking and feeling through the day, in their own words. Held with
  // the journal so a note is saved and carried between devices by the same debounced write.
  const [mindsetNotes, setMindsetNotes] = useState<MindsetNote[]>(() => storage.getMindsetNotes());
  // The plans the coach made on its own, with the trader's grades and feedback. Held with
  // the journal so a plan and its grade are saved and carried between devices by the same
  // debounced write.
  const [coachPlans, setCoachPlans] = useState<CoachPlan[]>(() => storage.getCoachPlans());
  // The trader's own notes about what needs fixing in the app. Held with the journal so they
  // are saved and carried between devices by the same debounced write as everything else.
  const [feedback, setFeedback] = useState<FeedbackNote[]>(() => storage.getFeedback());

  const currentState = useMemo<StorageState>(
    () => ({
      profile,
      instruments,
      // Kept with the instruments it describes, so a cloud copy carries the version the
      // list was brought to and the adopting device does not re-run a merge that skips it.
      instrumentCatalogVersion: storage.getInstrumentCatalogVersion(),
      setups,
      tradingDays,
      trades,
      reviews,
      patternStudies,
      levelTouches,
      markedLevels,
      levelOutlooks,
      mesLevels,
      sessionExtremes,
      chartSearches,
      lessons,
      coachPlans,
      feedback,
      lessonAck,
    }),
    [
      profile,
      instruments,
      setups,
      tradingDays,
      trades,
      reviews,
      patternStudies,
      levelTouches,
      markedLevels,
      levelOutlooks,
      mesLevels,
      sessionExtremes,
      chartSearches,
      lessons,
      coachPlans,
      feedback,
      lessonAck,
    ]
  );

  // Keep the latest state reachable from the sign-out handler without re-running effects.
  const currentStateRef = useRef(currentState);
  currentStateRef.current = currentState;

  /**
   * Adopts a snapshot as the whole journal, local storage included, so a reload
   * or a cloud copy taken in a conflict cannot leave the two disagreeing.
   */
  const applyJournalState = useCallback(
    (next: StorageState) => {
      storage.importData(JSON.stringify(next));
      setProfile({ ...next.profile, id: userId });
      // Re-runs the catalog merge against the snapshot just adopted, for the same reason
      // as the setups below: a copy taken before this release would otherwise reintroduce
      // the same missing contract.
      setInstruments(storage.ensureInstrumentCatalog());
      // Re-runs the catalog merge against the snapshot just adopted: a cloud copy taken
      // before this release would otherwise reintroduce the same missing setups.
      setSetups(storage.ensureSetupCatalog());
      setTradingDays(next.tradingDays);
      setTrades(next.trades);
      setReviews(next.reviews);
      setPatternStudies(next.patternStudies ?? []);
      setLevelTouches(next.levelTouches ?? []);
      setMarkedLevels(next.markedLevels ?? []);
      setLevelOutlooks(next.levelOutlooks ?? []);
      setMesLevels(next.mesLevels ?? []);
      setSessionExtremes(next.sessionExtremes ?? []);
      setChartSearches(next.chartSearches ?? []);
      setLessons(next.lessons ?? []);
      setCoachPlans(next.coachPlans ?? []);
      setFeedback(next.feedback ?? []);
      setLessonAck(next.lessonAck ?? null);
    },
    [userId]
  );

  return {
    profile,
    instruments,
    setups,
    tradingDays,
    trades,
    reviews,
    lessonAck,
    patternStudies,
    levelTouches,
    markedLevels,
    levelOutlooks,
    mesLevels,
    sessionExtremes,
    chartSearches,
    lessons,
    mindsetNotes,
    coachPlans,
    feedback,
    setProfile,
    setInstruments,
    setSetups,
    setTradingDays,
    setTrades,
    setReviews,
    setLessonAck,
    setPatternStudies,
    setLevelTouches,
    setMarkedLevels,
    setLevelOutlooks,
    setMesLevels,
    setSessionExtremes,
    setChartSearches,
    setLessons,
    setMindsetNotes,
    setCoachPlans,
    setFeedback,
    currentState,
    currentStateRef,
    applyJournalState,
  };
}
