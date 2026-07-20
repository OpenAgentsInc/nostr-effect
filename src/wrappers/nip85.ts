/**
 * NIP-85: Trusted Assertions
 *
 * Build assertion events (30382–30385) and provider preference lists (10040).
 *
 * @example
 * ```typescript
 * import {
 *   generateUserAssertionTemplate,
 *   generateProviderPreferencesTemplate,
 * } from 'nostr-effect/nip85'
 *
 * const assertion = generateUserAssertionTemplate(pubkey, { rank: '89' })
 * const prefs = generateProviderPreferencesTemplate({
 *   preferences: [{ kindTag: '30382:rank', serviceKey, relay }],
 * })
 * ```
 */

import { makeNip85Service } from "../client/Nip85Service.js"

const service = makeNip85Service()

export {
  ASSERTION_USER_KIND,
  ASSERTION_EVENT_KIND,
  ASSERTION_ADDRESS_KIND,
  ASSERTION_EXTERNAL_KIND,
  TRUSTED_PROVIDERS_KIND,
  type AssertionKind,
  type AssertionMetrics,
  type ProviderPreference,
  type EventTemplate,
} from "../client/Nip85Service.js"

export const generateAssertionEventTemplate = service.generateAssertionEventTemplate
export const generateUserAssertionTemplate = service.generateUserAssertionTemplate
export const generateEventAssertionTemplate = service.generateEventAssertionTemplate
export const generateAddressAssertionTemplate = service.generateAddressAssertionTemplate
export const generateExternalAssertionTemplate = service.generateExternalAssertionTemplate
export const parseAssertionMetrics = service.parseAssertionMetrics
export const validateAssertionEvent = service.validateAssertionEvent
export const generateProviderPreferencesTemplate = service.generateProviderPreferencesTemplate
export const parseProviderPreferences = service.parseProviderPreferences
export const validateProviderPreferencesEvent = service.validateProviderPreferencesEvent
