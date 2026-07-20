/**
 * NIP-CC: Geocaching Events
 */
import { makeNipCCService } from "../client/NipCCService.js"

const service = makeNipCCService()

export {
  GEOCACHE_LISTING_KIND,
  type GeocacheSize,
  type GeocacheListingParams,
  type GeocacheEventTemplate,
} from "../client/NipCCService.js"

export const generateGeocacheListingTemplate = service.generateGeocacheListingTemplate
export const validateGeocacheListing = service.validateGeocacheListing
export const parseGeocacheListing = service.parseGeocacheListing
