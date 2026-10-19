/**
 * Offline license handling shared by the standalone products.
 *
 * A static product has no server to ask, so a key is checked for shape and stored on the
 * buyer's device, with a one-per-device trial so the app can be opened before the receipt is
 * found. That is deliberately not DRM — a localStorage check can always be edited — and the
 * activation screen says so. Hosted features (coach, memory) verify Payhip keys server-side
 * instead.
 *
 * Each product gets its own storage keys, so installing two products on the same origin, or
 * later adding the full journal, cannot overwrite another product's activation.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Payhip's generated keys are four groups of five (`WTKP4-66NL5-HMKQW-GFSCZ`). The pattern
 * allows 4–6 characters per group and 3–5 groups, so a key from a different Payhip product,
 * or a pre-generated list, is not rejected for being a different width.
 */
const KEY_PATTERN = /^[A-Z0-9]{4,6}(?:-[A-Z0-9]{4,6}){2,4}$/;

export type LicenseStatus = 'licensed' | 'trial' | 'unlicensed';

export interface LicenseState {
  status: LicenseStatus;
  /** The stored key, when licensed. */
  key?: string;
  /** Whole days left in the trial, rounded up; never negative. */
  daysLeft?: number;
  /** ISO timestamp the current trial ends. */
  trialEndsAt?: string;
}

export interface StoredLicense {
  key: string;
  savedAt: string;
}

export interface StoredTrial {
  startedAt: string;
}

export interface OfflineLicenseConfig {
  /** Shown on the activation screen, e.g. "Chart Pattern Playbook". */
  productName: string;
  /** localStorage key for the stored license. */
  licenseKey: string;
  /** localStorage key for the trial start. */
  trialKey: string;
  /** Days the one-time trial lasts. */
  trialDays: number;
}

export interface OfflineLicense {
  config: OfflineLicenseConfig;
  normaliseKey(raw: string): string;
  isValidKey(raw: string): boolean;
  readStoredLicense(): StoredLicense | null;
  readTrialStart(): number | null;
  trialDaysLeft(now?: number): number | null;
  readState(now?: number): LicenseState;
  saveKey(raw: string, now?: Date): LicenseState;
  startTrial(now?: Date): LicenseState;
  clearKey(now?: number): LicenseState;
  maskKey(key: string): string;
}

/** Uppercases and strips whitespace, so a paste out of an email works. */
export function normaliseLicenseKey(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

/** Format only. A static product cannot ask Payhip whether the key was actually sold. */
export function isValidLicenseKey(raw: string): boolean {
  return KEY_PATTERN.test(normaliseLicenseKey(raw));
}

/** Masks a key for display: keeps the first and last group. */
export function maskLicenseKey(key: string): string {
  const parts = key.split('-');
  if (parts.length < 3) return key;
  return [parts[0], ...parts.slice(1, -1).map(() => '•••••'), parts[parts.length - 1]].join('-');
}

function readJson<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function createOfflineLicense(config: OfflineLicenseConfig): OfflineLicense {
  const readStoredLicense = (): StoredLicense | null => {
    const stored = readJson<Partial<StoredLicense>>(config.licenseKey);
    if (!stored || typeof stored.key !== 'string' || !isValidLicenseKey(stored.key)) {
      return null;
    }
    return {
      key: normaliseLicenseKey(stored.key),
      savedAt: typeof stored.savedAt === 'string' ? stored.savedAt : '',
    };
  };

  const readTrialStart = (): number | null => {
    const stored = readJson<Partial<StoredTrial>>(config.trialKey);
    if (!stored || typeof stored.startedAt !== 'string') return null;
    const started = Date.parse(stored.startedAt);
    return Number.isFinite(started) ? started : null;
  };

  const trialDaysLeft = (now: number = Date.now()): number | null => {
    const started = readTrialStart();
    if (started === null) return null;
    const remaining = started + config.trialDays * DAY_MS - now;
    return Math.max(0, Math.ceil(remaining / DAY_MS));
  };

  const readState = (now: number = Date.now()): LicenseState => {
    const license = readStoredLicense();
    if (license) return { status: 'licensed', key: license.key };

    const daysLeft = trialDaysLeft(now);
    if (daysLeft !== null && daysLeft > 0) {
      const started = readTrialStart() as number;
      return {
        status: 'trial',
        daysLeft,
        trialEndsAt: new Date(started + config.trialDays * DAY_MS).toISOString(),
      };
    }

    return { status: 'unlicensed' };
  };

  return {
    config,
    normaliseKey: normaliseLicenseKey,
    isValidKey: isValidLicenseKey,
    readStoredLicense,
    readTrialStart,
    trialDaysLeft,
    readState,
    saveKey(raw: string, now: Date = new Date()): LicenseState {
      const key = normaliseLicenseKey(raw);
      if (!isValidLicenseKey(key)) {
        throw new Error(
          'That does not look like a license key. It has groups of letters and numbers, like WTKP4-66NL5-HMKQW-GFSCZ.'
        );
      }
      writeJson(config.licenseKey, { key, savedAt: now.toISOString() } satisfies StoredLicense);
      return { status: 'licensed', key };
    },
    startTrial(now: Date = new Date()): LicenseState {
      if (readTrialStart() === null) {
        writeJson(config.trialKey, { startedAt: now.toISOString() } satisfies StoredTrial);
      }
      return readState(now.getTime());
    },
    clearKey(now: number = Date.now()): LicenseState {
      if (typeof window === 'undefined') return readState(now);
      try {
        localStorage.removeItem(config.licenseKey);
      } catch {
        // Nothing to do: the next read simply still finds the old key.
      }
      return readState(now);
    },
    maskKey: maskLicenseKey,
  };
}
