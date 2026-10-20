import React, { useState } from 'react';
import {
  Brain,
  CheckCircle2,
  Circle,
  Database,
  Info,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type {
  Instrument,
  MemoryAiSettings,
  Setup,
  Trade,
  TradingDay,
  TradingObservation,
} from '../../types';
import {
  MEMORY_MAX_RESULT_COUNT,
  MEMORY_MIN_RESULT_COUNT,
  clampMemoryResultCount,
} from '../../lib/memory/settings';
import { MEMORY_RESEMBLANCE_FLOOR } from '../../lib/memory/similarity';
import { isPreDecisionRole } from '../../lib/memory/eligibility';
import { countUnlabelledImages } from '../../lib/memory/journal-import';
import { useMemoryIndexing } from '../../lib/memory/use-memory-indexing';
import { sightingFromSearchChart } from '../../lib/memory/sighting';
import { ObservationLibrary } from './ObservationLibrary';
import { SightingPatternCard } from './SightingPatternCard';
import { MemorySearchView } from './MemorySearchView';
import { MemoryResearchView } from './MemoryResearchView';
import { MemoryEvaluationView } from './MemoryEvaluationView';

/**
 * The tab's sections.
 *
 * One scroll of six cards was the shape this screen had at two sections, and it stops working at
 * five: the trader arrives wanting one of "record", "find similar", "read my history" or "index the
 * backlog", and a wall of cards makes every one of them a scroll away from the one they wanted.
 *
 * The order is the order the work happens in, and the labels are the trader's words rather than the
 * implementation's: `library` is where observations are recorded and the switches live, then the
 * backlog that has to be indexed before a search can answer anything, then the search itself, then
 * the two read-only screens that judge the record and the retrieval.
 */
type MemorySection = 'library' | 'indexing' | 'search' | 'research' | 'evaluation';

const MEMORY_SECTIONS: { id: MemorySection; label: string; icon: React.ReactNode }[] = [
  { id: 'library', label: 'Library', icon: <Database className="h-3.5 w-3.5" /> },
  { id: 'indexing', label: 'Indexing', icon: <Sparkles className="h-3.5 w-3.5" /> },
  { id: 'search', label: 'Find similar', icon: <Brain className="h-3.5 w-3.5" /> },
  { id: 'research', label: 'Research', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  { id: 'evaluation', label: 'Retrieval quality', icon: <Info className="h-3.5 w-3.5" /> },
];

/**
 * Trading Memory: the tab that turns the journal into a memory of the market.
 *
 * The feature it is built around is one question, asked of the trader's own history:
 * *"Have I seen this setup before, how similar was it, and what actually happened afterwards?"*
 *
 * Two things about this screen are deliberate and worth stating, because both are the kind of
 * decision that is easy to get wrong later.
 *
 * **It is honest about what it can currently do.** The whole point of the feature is that its
 * answers rest on the trader's own recorded observations, so a search that has nothing indexed to
 * search cannot answer anything, and a screen that offered a search box anyway would be inviting
 * the trader to read an empty result as "nothing like this has happened before". Instead the
 * screen states which of the prerequisites is missing and what to do about it, and every one of
 * those lines is derived from real state rather than written by hand.
 *
 * **Consent is a control, not a formality.** Sending a private chart to a third-party model is the
 * trader's decision about their own material, so it is off until they turn it on, it says plainly
 * what turning it on means, and turning it off leaves the library completely usable — just not
 * searchable by similarity. A picture saved without consent is marked `skipped` rather than
 * quietly left un-embedded and forgotten, so the library always says what is searchable and why.
 */

export interface TradingMemoryViewProps {
  observations: TradingObservation[];
  instruments: Instrument[];
  setups: Setup[];
  trades: Trade[];
  tradingDays: TradingDay[];
  timezone: string;
  userId: string;
  todayTradeDate: string;
  aiSettings: MemoryAiSettings;
  /** True when a Supabase project is configured, which is what private storage and the index need. */
  cloudEnabled: boolean;
  onSaveObservation: (observation: TradingObservation) => void;
  onDeleteObservation: (id: string) => void;
  onChangeAiSettings: (patch: Partial<MemoryAiSettings>) => void;
  onViewTrade: (trade: Trade) => void;
}

const Card: React.FC<{
  id?: string;
  title: string;
  icon: React.ReactNode;
  subtitle?: string;
  children: React.ReactNode;
}> = ({ id, title, icon, subtitle, children }) => (
  <section id={id} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 backdrop-blur-sm sm:p-5">
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 text-sky-300">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-bold tracking-tight text-zinc-100">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">{subtitle}</p>}
        <div className="mt-3">{children}</div>
      </div>
    </div>
  </section>
);

/** One line of the prerequisite checklist. */
const Prerequisite: React.FC<{ met: boolean; label: string; detail: string; id: string }> = ({
  met,
  label,
  detail,
  id,
}) => (
  <li id={id} data-met={met} className="flex items-start gap-2">
    {met ? (
      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
    ) : (
      <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-600" />
    )}
    <span className="min-w-0">
      <span className={`text-[11px] font-semibold ${met ? 'text-zinc-200' : 'text-zinc-400'}`}>
        {label}
      </span>
      <span className="block text-[10px] leading-relaxed text-zinc-500">{detail}</span>
    </span>
  </li>
);

export const TradingMemoryView: React.FC<TradingMemoryViewProps> = ({
  observations,
  instruments,
  setups,
  trades,
  tradingDays,
  timezone,
  userId,
  todayTradeDate,
  aiSettings,
  cloudEnabled,
  onSaveObservation,
  onDeleteObservation,
  onChangeAiSettings,
  onViewTrade,
}) => {
  const [showConsentDetail, setShowConsentDetail] = useState(false);
  // The library is the default because it is where recording happens, and because it is the one
  // section that works on a journal with no cloud, no consent and nothing indexed yet.
  const [section, setSection] = useState<MemorySection>('library');
  /**
   * The record a search asked to open, once the library is the section on screen.
   *
   * Held here rather than inside the library because the click happens on the search screen: the
   * section switch and the scroll have to be two halves of one action, and state is what carries
   * the second half across the re-render.
   */
  const [focusObservationId, setFocusObservationId] = useState<string | null>(null);

  /**
   * The indexing run, driven here rather than inside a card so its progress survives the trader
   * switching to the library to look at something while it works.
   */
  const indexing = useMemoryIndexing({
    observations,
    consent: aiSettings.imageProcessingConsent,
    cloudEnabled,
    // The hook moves inline screenshots into private storage and hands back the records that now
    // point at them. Persisting that is the caller's job: without it the next run re-offers
    // pictures that already moved, which is idempotent but wasteful.
    onObservationsMigrated: (migrated) => migrated.forEach(onSaveObservation),
  });

  const observationCount = observations.length;
  const indexedCount = observations.filter((observation) =>
    (observation.images ?? []).some((image) => image.indexStatus === 'completed')
  ).length;
  // Only pictures that are actually queued. A picture brought in from the journal is `pending` the
  // moment consent exists, but no run will send it while it is unlabelled, and counting it as
  // "waiting to index" would promise work the engine is going to refuse — which is exactly the kind
  // of number this tab is supposed to be honest about.
  const awaitingIndex = observations.filter((observation) =>
    (observation.images ?? []).some(
      (image) => image.indexStatus === 'pending' && isPreDecisionRole(image.role)
    )
  ).length;
  // Pictures that are in the library but carry no role yet, so nothing can match on them.
  const unlabelledCount = countUnlabelledImages(observations);
  const skippedCount = observations.filter((observation) =>
    (observation.images ?? []).some((image) => image.indexStatus === 'skipped')
  ).length;
  const failedCount = observations.filter((observation) =>
    (observation.images ?? []).some((image) => image.indexStatus === 'failed')
  ).length;

  const withOutcome = observations.filter(
    (observation) => observation.outcome?.status === 'recorded'
  ).length;

  const consent = aiSettings.imageProcessingConsent;

  return (
    <div className="space-y-5">
      {/* ---- What this is ---- */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 backdrop-blur-sm sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight text-zinc-100">
              <Brain className="h-5 w-5 text-sky-400" />
              Trading Memory
            </h1>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-zinc-400">
              Your own market memory. Take a picture of the chart you are studying, write what you
              saw under it, and this becomes the place you ask: <em>have I seen this before, how
              similar was it, and what actually happened afterwards?</em> The notes are also what
              your coach reads to name the pattern you keep coming back to. Everything here is
              answered from your own records — it is not a forecast, and it never tells you what to
              do.
            </p>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: 'Observations', value: observationCount },
              { label: 'Searchable', value: indexedCount },
              { label: 'With an outcome', value: withOutcome },
              { label: 'Waiting to index', value: awaitingIndex },
            ].map((fact) => (
              <div
                key={fact.label}
                className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-center"
              >
                <div className="font-mono text-base font-semibold text-zinc-100">{fact.value}</div>
                <div className="text-[9px] uppercase tracking-wide text-zinc-500">{fact.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ---- Section switcher ---- */}
      <nav
        id="memory-sections"
        aria-label="Memory sections"
        className="flex flex-wrap gap-1.5 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-1.5 backdrop-blur-sm"
      >
        {MEMORY_SECTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            id={`memory-section-${entry.id}`}
            aria-current={section === entry.id}
            onClick={() => setSection(entry.id)}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
              section === entry.id
                ? 'bg-sky-500/20 text-sky-200'
                : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
            }`}
          >
            {entry.icon}
            {entry.label}
          </button>
        ))}
      </nav>

      {section === 'library' && (
        <>
      {/* ---- Privacy and consent ---- */}
      <Card
        id="memory-consent"
        title="Sending your charts to the AI provider"
        icon={<ShieldCheck className="h-3.5 w-3.5" />}
        subtitle="Off until you say otherwise. Turning it on is what makes the library searchable by similarity; leaving it off never stops you recording or reading it."
      >
        <div className="space-y-3">
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
            <input
              id="memory-consent-toggle"
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-sky-500"
              checked={consent}
              onChange={(e) =>
                onChangeAiSettings({ imageProcessingConsent: e.target.checked })
              }
            />
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-zinc-100">
                Let new screenshots be indexed for similarity search
              </span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-zinc-400">
                Each accepted screenshot is turned into a numeric embedding by Google's Gemini
                embedding model and stored with your journal. The picture itself still lives in your
                private storage — only the vector is kept beside it.
              </span>
            </span>
          </label>

          {consent ? (
            <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-amber-300/90">
              <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                You are using a model provider's API to process your own charts. On an unpaid tier
                Google may use submitted content to improve its products and may have it reviewed by
                people, under its own terms — this is worth reading before consenting, and worth
                reconsidering for a chart you would not want read. Turning this off stops new
                pictures being sent; anything already indexed stays in your index until you remove
                it.
              </span>
            </p>
          ) : (
            <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-zinc-500">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                With this off, a screenshot you save is stored privately and marked{' '}
                <span className="font-mono">skipped</span>. It can be read, edited and exported — it
                simply cannot be found by a similarity search.
              </span>
            </p>
          )}

          <button
            type="button"
            id="memory-consent-detail-toggle"
            onClick={() => setShowConsentDetail((open) => !open)}
            aria-expanded={showConsentDetail}
            className="text-[10px] font-semibold text-sky-400 underline decoration-sky-500/40 transition-colors hover:text-sky-300"
          >
            {showConsentDetail ? 'Hide' : 'What exactly gets sent, and when'}
          </button>

          {showConsentDetail && (
            <ul className="space-y-1.5 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-[10px] leading-relaxed text-zinc-400">
              <li>
                <span className="font-semibold text-zinc-300">When a picture is picked:</span>{' '}
                nothing leaves this device. It is compressed and written to your private storage.
              </li>
              <li>
                <span className="font-semibold text-zinc-300">When it is indexed:</span> the
                compressed picture is posted once to your own serverless endpoint, which forwards it
                to the embedding model with the server's key and returns a vector. The key is never
                in the browser.
              </li>
              <li>
                <span className="font-semibold text-zinc-300">On a search:</span> one picture — the
                chart you upload — is embedded, and the lookup runs against vectors already stored.
                Your whole library is never re-sent.
              </li>
              <li>
                <span className="font-semibold text-zinc-300">What is stored:</span> the vector, the
                model name, the model version and the input size, so two generations of embeddings
                can never be ranked against each other by mistake.
              </li>
            </ul>
          )}
        </div>
      </Card>

      {/* ---- Where the search stands ---- */}
      <Card
        id="memory-search-readiness"
        title="Similarity search"
        icon={<Database className="h-3.5 w-3.5" />}
        subtitle="The search itself reads a vector index over your whole library. It needs all three of these; each line below says what is actually true right now."
      >
        <ul className="space-y-2.5">
          <Prerequisite
            id="memory-prereq-cloud"
            met={cloudEnabled}
            label="A Supabase project is configured"
            detail={
              cloudEnabled
                ? 'Private storage and the vector index have somewhere to live.'
                : 'Without it this journal is local-only: screenshots are kept in this browser and cannot be indexed at all.'
            }
          />
          <Prerequisite
            id="memory-prereq-schema"
            met={cloudEnabled}
            label="The memory schema has been applied"
            detail="Run supabase/schema.sql once in the SQL editor. It is additive and safe to re-run; it creates the private bucket, the observation tables, the vector index and the search function."
          />
          <Prerequisite
            id="memory-prereq-consent"
            met={consent}
            label="Image processing is consented to"
            detail={
              consent
                ? 'New screenshots are queued for indexing.'
                : 'Turn the switch above on before any screenshot can be embedded.'
            }
          />
          <Prerequisite
            id="memory-prereq-pictures"
            met={indexedCount > 0}
            label="At least one picture has been indexed"
            detail={
              indexedCount > 0
                ? `${indexedCount} observation${indexedCount === 1 ? '' : 's'} can currently be found by similarity.`
                : 'The index is empty, so a search could only ever report that it found nothing — which is not the same answer as "this has not happened before".'
            }
          />
        </ul>

        {observationCount > 0 && indexedCount === 0 && (
          <p className="mt-3 text-[10px] leading-relaxed text-zinc-500">
            {awaitingIndex > 0
              ? `${awaitingIndex} observation${awaitingIndex === 1 ? '' : 's'} have a picture waiting to be indexed.`
              : unlabelledCount > 0
              ? unlabelledCount === 1
                ? 'One picture has come in from the journal and is waiting for you to say what it shows, in the Library. Until then no run will send it.'
                : `${unlabelledCount} pictures have come in from the journal and are waiting for you to say what they show, in the Library. Until then no run will send them.`
              : skippedCount > 0
              ? `${skippedCount} observation${skippedCount === 1 ? '' : 's'} hold a picture that was saved without consent, so nothing was sent.`
              : 'No picture has been attached to an observation yet.'}
            {failedCount > 0
              ? ` ${failedCount} picture${failedCount === 1 ? '' : 's'} failed to index and can be retried.`
              : ''}
          </p>
        )}
      </Card>

      {/* ---- How results will be shown and ranked ---- */}
      <Card
        id="memory-result-settings"
        title="How matches are shown"
        icon={<Sparkles className="h-3.5 w-3.5" />}
        subtitle="These only change what is displayed. They never change a score, and they never change what happened."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor="memory-floor" className="text-[10px] font-mono uppercase font-bold text-zinc-400">
                Resemblance floor
              </label>
              <span
                id="memory-floor-value"
                data-floor={aiSettings.resemblanceFloor}
                className="font-mono text-[11px] text-zinc-100"
              >
                {aiSettings.resemblanceFloor}%
              </span>
            </div>
            <input
              id="memory-floor"
              type="range"
              min={20}
              max={80}
              step={5}
              value={aiSettings.resemblanceFloor}
              onChange={(e) => onChangeAiSettings({ resemblanceFloor: Number(e.target.value) })}
              className="w-full accent-sky-500"
            />
            <p className="text-[10px] leading-relaxed text-zinc-500">
              A match must score at least this close to be listed. The score is a{' '}
              <span className="text-zinc-400">normalised resemblance</span> between two images — it
              is not a probability, and it says nothing about whether either one worked. The default
              is {MEMORY_RESEMBLANCE_FLOOR}%.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="memory-results" className="text-[10px] font-mono uppercase font-bold text-zinc-400">
              Matches to return
            </label>
            <input
              id="memory-results"
              type="number"
              min={MEMORY_MIN_RESULT_COUNT}
              max={MEMORY_MAX_RESULT_COUNT}
              value={aiSettings.resultCount}
              onChange={(e) =>
                onChangeAiSettings({ resultCount: clampMemoryResultCount(Number(e.target.value)) })
              }
              className="w-24 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-sky-600 focus:outline-none"
            />
            <p className="text-[10px] leading-relaxed text-zinc-500">
              Between {MEMORY_MIN_RESULT_COUNT} and {MEMORY_MAX_RESULT_COUNT}. A list past a couple
              of dozen stops being read, and every extra match is one more row to weigh rather than
              a better answer.
            </p>
          </div>
        </div>
      </Card>

      {/* ---- The library ---- */}
      <ObservationLibrary
        observations={observations}
        instruments={instruments}
        setups={setups}
        trades={trades}
        tradingDays={tradingDays}
        timezone={timezone}
        userId={userId}
        todayTradeDate={todayTradeDate}
        consentToIndex={consent}
        cloudEnabled={cloudEnabled}
        onSave={onSaveObservation}
        onDelete={onDeleteObservation}
        onViewTrade={onViewTrade}
        focusObservationId={focusObservationId ?? undefined}
      />

      {/* The reason the notes exist: what they keep saying across sightings. */}
      <SightingPatternCard
        observations={observations}
        instruments={instruments}
        setups={setups}
        trades={trades}
        tradingDays={tradingDays}
        timezone={timezone}
        todayTradeDate={todayTradeDate}
      />

      <p className="px-1 text-[10px] leading-relaxed text-zinc-600">
        Answers here are built only from what you have recorded. A small library cannot support a
        conclusion, and the screens say so rather than rounding a handful of cases into a
        percentage. Nothing on this tab predicts a market, and nothing here can place a trade.
      </p>
        </>
      )}

      {/* ---- Indexing ---- */}
      {section === 'indexing' && (
        <Card
          id="memory-indexing"
          title="Indexing your library"
          icon={<Sparkles className="h-3.5 w-3.5" />}
          subtitle="Turns each stored screenshot into a vector, one picture per request. It is resumable, it can be stopped, and a run that did not finish says so instead of reporting success."
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                // NOT "in the journal". `totalImages` counts the pictures the MEMORY library holds,
                // and the journal's own screenshots are a different collection this engine never
                // reads — a label that said "journal" was the whole reason a journal full of charts
                // showed zero here and read as a broken feature.
                { label: 'Pictures in this library', value: indexing.plan.totalImages },
                { label: 'Ready to send', value: indexing.plan.candidates.length },
                { label: 'Already indexed', value: indexing.plan.skippedByReason['already-indexed'] },
                { label: 'Waiting on consent', value: indexing.plan.skippedByReason['no-consent'] },
              ].map((fact) => (
                <div
                  key={fact.label}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-center"
                >
                  <div className="font-mono text-base font-semibold text-zinc-100">{fact.value}</div>
                  <div className="text-[9px] uppercase tracking-wide text-zinc-500">{fact.label}</div>
                </div>
              ))}
            </div>

            {/*
              Says plainly what this engine does not read. The number above is the one a trader
              compares against their journal, so without this the honest state — a brand-new
              library sitting beside a full journal — is indistinguishable from a broken feature.
            */}
            <p
              id="memory-indexing-scope"
              className="flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-400"
            >
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" />
              <span>
                <strong className="font-semibold text-zinc-300">
                  Sightings only, not your whole journal.
                </strong>{' '}
                A chart attached to a trade, a session or a lesson belongs to that record and is never
                read here — this engine searches the observation library. That is why a journal
                holding hundreds of screenshots can still have nothing searchable in it.{' '}
                <em>Find similar</em> keeps the chart you are looking at, and the Library's{' '}
                <em>Bring in the charts your journal already has</em> copies the trade screenshots you
                already own across — where they arrive unlabelled, and are matched on only once you
                say which ones were in front of you before you decided.
              </span>
            </p>

            {/*
             * A picture re-sent because the model or its output size changed. This is not a skip:
             * its stored vector is comparable with nothing, so it is work to do. Saying so here is
             * what stops a library that looks fully indexed from being silently unsearchable.
             */}
            {indexing.plan.candidates.some((candidate) => candidate.reason === 'stale-embedding') && (
              <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-amber-300/90">
                <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  {
                    indexing.plan.candidates.filter((c) => c.reason === 'stale-embedding').length
                  }{' '}
                  picture(s) were embedded by an earlier model or output size. Those vectors cannot be
                  compared with a query's, so they are re-sent rather than reused.
                </span>
              </p>
            )}

            {indexing.refusal && (
              <p id="memory-indexing-refusal" className="text-[11px] leading-relaxed text-amber-300/90">
                {indexing.refusal}
              </p>
            )}
            {indexing.error && (
              <p id="memory-indexing-error" className="text-[11px] leading-relaxed text-rose-300">
                {indexing.error}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                id="memory-index-run"
                onClick={() => void indexing.runBackfill()}
                disabled={indexing.running || !consent}
                className="rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                {indexing.running ? 'Indexing…' : 'Move and index the backlog'}
              </button>
              <button
                type="button"
                id="memory-index-cancel"
                onClick={indexing.cancel}
                disabled={!indexing.running}
                className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600"
              >
                Stop
              </button>
              <span className="text-[10px] leading-relaxed text-zinc-500">
                Stopping takes effect after the picture already in flight.
              </span>
            </div>

            {indexing.progress && (
              <div id="memory-index-progress" className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="font-mono text-xs text-zinc-300">
                  {indexing.progress.settled} settled · {indexing.progress.indexed} indexed ·{' '}
                  {indexing.progress.failed} failed
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                  Counted after each picture has finished, so nothing shown as indexed is still in
                  flight.
                </p>
              </div>
            )}

            {indexing.summary && (
              <p id="memory-index-summary" className="text-[11px] leading-relaxed text-zinc-300">
                {indexing.summary}
              </p>
            )}

            {indexing.paused && (
              <p className="text-[10px] leading-relaxed text-amber-300/90">
                The provider is metering the key right now, so the run paused rather than failing.
                Everything already indexed is kept; run it again to continue.
              </p>
            )}

            {indexing.lastJob && (
              <p id="memory-index-last-job" className="text-[10px] leading-relaxed text-zinc-500">
                The last run is recorded as{' '}
                <span className="font-mono text-zinc-400">{indexing.lastJob.status}</span> —{' '}
                {indexing.lastJob.processedItems} of {indexing.lastJob.totalItems} pictures,{' '}
                {indexing.lastJob.failedItems} failed.
                {indexing.lastJob.lastError ? ` Last error: ${indexing.lastJob.lastError}` : ''}
              </p>
            )}
          </div>
        </Card>
      )}

      {/* ---- Find similar ---- */}
      {section === 'search' && (
        <MemorySearchView
          aiSettings={aiSettings}
          observations={observations}
          trades={trades}
          cloudEnabled={cloudEnabled}
          onViewTrade={onViewTrade}
          /*
            The one recorded action the search screen offers, and the only path by which a chart
            held up against the library becomes part of it. `sightingFromSearchChart` owns the shape
            of what gets recorded — the role, the absent outcome, the pending index status — so this
            component does not have to know any of it, and the shape is unit-tested on its own.
          */
          onRecordSighting={({ dataUrl, filters }) =>
            onSaveObservation(sightingFromSearchChart({ userId, timezone, dataUrl, filters }))
          }
          onOpenObservation={(observationId) => {
            setFocusObservationId(observationId);
            setSection('library');
          }}
        />
      )}

      {/* ---- Research ---- */}
      {/*
        `onOpenObservation` is deliberately NOT passed. The dashboard renders an "open the most
        recent sighting" button when it is, and there is nothing behind that button yet: the library
        has no way to open a named record, so the handler would switch to the library and leave the
        trader to find it. A button that promises a specific sighting and delivers a list is worse
        than no button. Wiring it up means an `initialObservationId` on `ObservationLibrary`, which
        is a change to that component rather than to this one.
      */}
      {section === 'research' && (
        <MemoryResearchView observations={observations} trades={trades} />
      )}

      {/* ---- Retrieval quality ---- */}
      {section === 'evaluation' && (
        <MemoryEvaluationView retentionDays={aiSettings.searchRetentionDays} />
      )}
    </div>
  );
};
