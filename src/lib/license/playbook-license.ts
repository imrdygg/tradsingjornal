/**
 * The Chart Pattern Playbook's license.
 *
 * All the rules live in `offline-license.ts`; this file only names the product and its
 * storage keys. The named exports are kept so existing call sites and tests read the same
 * as before. The keys are product-specific (`ptj_playbook_*`), so installing the MES
 * tracker or the full journal on the same origin cannot overwrite this activation.
 */
import {
  createOfflineLicense,
  type LicenseState,
  type LicenseStatus,
  type StoredLicense,
} from './offline-license';

export type { LicenseState, LicenseStatus, StoredLicense };

export const PLAYBOOK_LICENSE = createOfflineLicense({
  productName: 'Chart Pattern Playbook',
  licenseKey: 'ptj_playbook_license_v1',
  trialKey: 'ptj_playbook_trial_v1',
  trialDays: 7,
});

export const LICENSE_STORAGE_KEY = PLAYBOOK_LICENSE.config.licenseKey;
export const TRIAL_STORAGE_KEY = PLAYBOOK_LICENSE.config.trialKey;
export const TRIAL_DAYS = PLAYBOOK_LICENSE.config.trialDays;

export const normaliseLicenseKey = PLAYBOOK_LICENSE.normaliseKey;
export const isValidLicenseKey = PLAYBOOK_LICENSE.isValidKey;
export const maskLicenseKey = PLAYBOOK_LICENSE.maskKey;
export const readStoredLicense = PLAYBOOK_LICENSE.readStoredLicense;
export const readTrialStart = PLAYBOOK_LICENSE.readTrialStart;
export const trialDaysLeft = PLAYBOOK_LICENSE.trialDaysLeft;
export const readLicenseState = PLAYBOOK_LICENSE.readState;
export const saveLicenseKey = PLAYBOOK_LICENSE.saveKey;
export const startTrial = PLAYBOOK_LICENSE.startTrial;
export const clearLicenseKey = PLAYBOOK_LICENSE.clearKey;
