/**
 * NIP-5A: Static Websites (nsites)
 */
import { makeNip5AService } from "../client/Nip5AService.js"

const service = makeNip5AService()

export {
  NSITE_ROOT_KIND,
  NSITE_NAMED_KIND,
  NSITE_D_PATTERN,
  type NsitePath,
  type NsiteManifestParams,
  type NsiteEventTemplate,
} from "../client/Nip5AService.js"

export const generateRootSiteTemplate = service.generateRootSiteTemplate
export const generateNamedSiteTemplate = service.generateNamedSiteTemplate
export const validateNsiteEvent = service.validateNsiteEvent
export const parsePaths = service.parsePaths
