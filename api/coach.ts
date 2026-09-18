import { GoogleGenAI } from '@google/genai';
import {
  buildCoachPrompt,
  isCoachMode,
  parseCoachResponse,
  CoachTradeFacts,
} from '../src/lib/ai/coach-prompts';
import { JournalDigest } from '../src/lib/ai/journal-digest';

/**
 * The AI coach endpoint.
 *
 * This runs on the server for two reasons:
 *  1. The Gemini API key is a server secret. Anything the browser touches ships to
 *     every visitor, so the key must never reach the client.
 *  2. The guardrails in coach-prompts.ts are applied here, so the browser cannot
 *     rewrite the system instruction that forbids market claims and predictions.
 *
 * The client only sends its own journal digest. The server owns the prompt.
 */

// `tsconfig.json` restricts global types to vite/client, so Node's globals are not
// declared. Declaring just what this function needs keeps Node types out of the
// frontend typecheck, where `process` should not be available.
declare const process: { env: Record<string, string | undefined> };

interface ApiRequest {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
}

interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}

/** Vercel parses JSON bodies, but a raw string is possible depending on runtime. */
function readBody(body: unknown): Record<string, unknown> | null {
  if (!body) return null;
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  if (typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  return null;
}

/**
 * Minimal shape check on the digest. We do not fully re-validate every field — the
 * client built it from its own types — but we must reject anything that would leave
 * the prompt with no facts at all, because a coach with no data invents data.
 */
function hasUsableDigest(value: unknown): value is JournalDigest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const digest = value as Partial<JournalDigest>;
  return (
    !!digest.dataSufficiency &&
    typeof digest.dataSufficiency === 'object' &&
    !!digest.overall &&
    typeof digest.overall === 'object' &&
    !!digest.today &&
    typeof digest.today === 'object'
  );
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // The most likely cause on a live site: the env var was added after the last
    // deploy, or it was named with a VITE_ prefix and so never reached the server.
    res.status(503).json({
      error:
        'The coach is not configured on the server. Add GEMINI_API_KEY to the hosting ' +
        'environment variables (without a VITE_ prefix) and redeploy.',
      code: 'unconfigured',
    });
    return;
  }

  const body = readBody(req.body);
  const mode = body?.mode;

  if (!isCoachMode(mode)) {
    res.status(400).json({ error: 'Unknown coach mode. Expected brief, weekly or trade.' });
    return;
  }
  if (!hasUsableDigest(body?.digest)) {
    res.status(400).json({ error: 'The request did not include a usable journal digest.' });
    return;
  }

  const trade = mode === 'trade' ? (body?.trade as CoachTradeFacts | undefined) : undefined;
  if (mode === 'trade' && (!trade || typeof trade !== 'object')) {
    res.status(400).json({ error: 'Trade mode needs the trade to critique.' });
    return;
  }

  // The prompt is assembled here, on the server, from the digest the client sent.
  const { systemInstruction, userPrompt } = buildCoachPrompt(mode, body.digest, trade);

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
      contents: userPrompt,
      config: {
        systemInstruction,
        // Ask for JSON directly, then validate it ourselves: a schema mismatch is
        // better reported as a readable error than rendered as a hole in the UI.
        responseMimeType: 'application/json',
        temperature: 0.7,
      },
    });

    const text = response.text;
    if (!text) {
      res.status(502).json({ error: 'The coach returned an empty response.' });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }

    let data;
    try {
      data = parseCoachResponse(mode, parsed);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'The coach returned an unusable response.',
      });
      return;
    }

    res.status(200).json({ mode, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Surface quota problems distinctly: retrying will not help and hiding it wastes
    // the trader's time.
    if (/quota|rate limit|429|resource_exhausted/i.test(message)) {
      res.status(429).json({
        error: 'The coach has hit its Gemini rate limit. Try again in a minute.',
        code: 'rate_limited',
      });
      return;
    }
    if (/api key|permission|unauthorized|403|400/i.test(message) && /key/i.test(message)) {
      res.status(502).json({
        error: 'Gemini rejected the server API key. Check GEMINI_API_KEY on the host.',
        code: 'bad_key',
      });
      return;
    }

    console.error('[coach] Gemini request failed:', message);
    res.status(502).json({ error: `The coach could not be reached: ${message}` });
  }
}
