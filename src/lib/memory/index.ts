/**
 * The Trading Memory engine's non-UI half.
 *
 * Split by question rather than by layer, because each module answers one and is testable on its
 * own:
 *
 *   - `eligibility` — what may be matched at all, and what was knowable when (the boundary that
 *     keeps hindsight out of a search).
 *   - `similarity`  — a vector distance turned into a readable resemblance, and a deterministic
 *     ranking over the candidates.
 *   - `outcomes`    — what the matched cases actually amounted to, with the denominators spelt
 *     out.
 *   - `storage`     — the private bucket: paths, checksums, verified uploads, signed URLs, and
 *     the migration that moves an existing library off inline base64.
 *   - `settings`    — the trader's consent and display choices, with their bounds.
 *   - `backfill`    — what an indexing run over the pictures already in the journal should send.
 *   - `journal-import` — what of the journal's OWN screenshots can be brought into the library,
 *     and in what role; with `journal-import-runner` as the part that reads and uploads them.
 *   - `index-runner`— the loop that gives picture after picture an embedding, and stops honestly.
 *   - `db`          — the tables, and the one similarity query, with the mappers between them.
 *   - `evaluation`  — whether retrieval actually finds anything, measured rather than asserted.
 *
 * Nothing here imports React, and nothing here talks to the coach. The serverless calls, the
 * database reads and the screens live beside this, so the rules above can be tested without a
 * browser, a bucket or a model.
 *
 * What is deliberately NOT re-exported: `embedding-api`. It is the only module here that reaches
 * the network on the browser's behalf, and the serverless handler imports its wire contract
 * directly — so keeping it out of this barrel is what stops a future import of `../lib/memory`
 * dragging a Supabase session into `api/memory.js`.
 */

export * from './backfill';
export * from './db';
export * from './eligibility';
export * from './eval-sources';
export * from './evaluation';
export * from './index-runner';
export * from './journal-import';
export * from './journal-import-runner';
export * from './research';
export * from './outcomes';
export * from './settings';
export * from './similarity';
export * from './storage';
