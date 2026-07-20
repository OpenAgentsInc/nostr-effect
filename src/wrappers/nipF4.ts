/**
 * NIP-F4: Podcasts
 */
import { makeNipF4Service } from "../client/NipF4Service.js"

const service = makeNipF4Service()

export {
  PODCAST_METADATA_KIND,
  PODCAST_AUTHOR_CLAIM_KIND,
  PODCAST_EPISODE_KIND,
  PODCAST_FAVORITES_KIND,
  type PodcastMetadataParams,
  type PodcastEpisodeParams,
  type PodcastEventTemplate,
} from "../client/NipF4Service.js"

export const generatePodcastMetadataTemplate = service.generatePodcastMetadataTemplate
export const generateAuthorClaimTemplate = service.generateAuthorClaimTemplate
export const generateEpisodeTemplate = service.generateEpisodeTemplate
export const generateFavoritesTemplate = service.generateFavoritesTemplate
export const validatePodcastMetadata = service.validatePodcastMetadata
export const validateEpisode = service.validateEpisode
