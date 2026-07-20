/**
 * NIP-A4: Public Messages (kind 24)
 */
import { makeNipA4Service } from "../client/NipA4Service.js"

const service = makeNipA4Service()

export {
  PUBLIC_MESSAGE_KIND,
  type PublicMessageReceiver,
  type PublicMessageParams,
  type NipA4EventTemplate,
} from "../client/NipA4Service.js"

export const generatePublicMessageTemplate = service.generatePublicMessageTemplate
export const validatePublicMessageEvent = service.validatePublicMessageEvent
export const parseReceivers = service.parseReceivers
