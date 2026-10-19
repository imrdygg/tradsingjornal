/**
 * The MES Indicator Level Tracker's license.
 *
 * Same offline rules as the playbook, with its own storage keys so the two products can be
 * installed on the same origin without sharing a trial or an activation.
 */
import { createOfflineLicense } from './offline-license';

export const MES_LICENSE = createOfflineLicense({
  productName: 'MES Indicator Level Tracker',
  licenseKey: 'ptj_mes_license_v1',
  trialKey: 'ptj_mes_trial_v1',
  trialDays: 7,
});

export const MES_LICENSE_STORAGE_KEY = MES_LICENSE.config.licenseKey;
export const MES_TRIAL_STORAGE_KEY = MES_LICENSE.config.trialKey;
export const MES_TRIAL_DAYS = MES_LICENSE.config.trialDays;
