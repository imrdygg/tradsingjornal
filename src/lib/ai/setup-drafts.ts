import type { Setup } from '../../types';
import type { LearnedSetup } from './coach-types';

/**
 * Turning a named setup into something the playbook can hold.
 *
 * Two coach surfaces propose setups — the playbook's own read, and the picture search once
 * it has found the trades a chart resembles — and they must produce the same thing when
 * they do. A draft written by one has to behave exactly like a draft written by the other:
 * the same origin badge, the same editable shape, the same rule about not duplicating a
 * name the trader already keeps. Keeping that in one place is what stops the two drifting
 * into two slightly different kinds of setup.
 */

/**
 * Turns one proposed setup into an editable draft for the playbook.
 *
 * `origin` says which read produced it: the playbook's own read over the journal, or a
 * picture search that was handed a chart and the trades it matched. Both are AI drafts and
 * behave identically from here; the difference exists only so the Playbook can label them.
 */
export function buildSetupDraft(
  learned: LearnedSetup,
  origin: NonNullable<Setup['origin']> = 'ai'
): Setup {
  const rules = learned.entryRules.length
    ? ['', 'Entry rules:', ...learned.entryRules.map((rule) => `- ${rule}`)]
    : [];
  return {
    id: `setup-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: learned.name,
    active: true,
    description: [learned.description, ...rules, '', `Coach's evidence: ${learned.evidence}`]
      .join('\n')
      .trim(),
    origin,
    createdAt: new Date().toISOString(),
  };
}

/**
 * The proposals that are actually new, as playbook drafts.
 *
 * Compared case-insensitively against the catalog the way every other setup name is, so a
 * proposal that merely repeats one the trader already keeps is dropped instead of shadowing
 * it. Duplicates inside a single answer are dropped for the same reason.
 */
export function newSetupDrafts(
  proposed: LearnedSetup[],
  existing: Setup[],
  origin: NonNullable<Setup['origin']> = 'ai'
): Setup[] {
  const taken = new Set(existing.map((setup) => setup.name.trim().toLowerCase()));
  const drafts: Setup[] = [];

  for (const learned of proposed) {
    const name = learned.name.trim();
    const key = name.toLowerCase();
    if (!name || taken.has(key)) continue;
    taken.add(key);
    drafts.push(buildSetupDraft({ ...learned, name }, origin));
  }
  return drafts;
}
