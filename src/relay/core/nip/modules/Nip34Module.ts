/**
 * NIP-34 Module
 *
 * Git collaboration events are handled by the relay's standard storage and
 * subscription pipeline. Repository and state announcements are
 * parameterized replaceable events, so their replacement semantics are
 * provided by the NIP-16/33 module.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/34.md
 */
import {
  GRASP_LIST_KIND,
  ISSUE_KIND,
  PATCH_KIND,
  PULL_REQUEST_KIND,
  PULL_REQUEST_UPDATE_KIND,
  REPLY_KIND,
  REPOSITORY_KIND,
  REPOSITORY_STATE_KIND,
  STATUS_APPLIED_KIND,
  STATUS_CLOSED_KIND,
  STATUS_DRAFT_KIND,
  STATUS_OPEN_KIND,
} from "../../../../core/Nip34.js"
import { createModule, type NipModule } from "../NipModule.js"

/**
 * Advertises NIP-34 support and routes all git-forge event kinds through the
 * standard relay event pipeline.
 */
export const Nip34Module: NipModule = createModule({
  id: "nip-34",
  nips: [34],
  description: "Git collaboration events for repositories, patches, pull requests, issues, replies, and statuses.",
  kinds: [
    REPOSITORY_KIND as number,
    REPOSITORY_STATE_KIND as number,
    PATCH_KIND as number,
    PULL_REQUEST_KIND as number,
    PULL_REQUEST_UPDATE_KIND as number,
    ISSUE_KIND as number,
    REPLY_KIND as number,
    STATUS_OPEN_KIND as number,
    STATUS_APPLIED_KIND as number,
    STATUS_CLOSED_KIND as number,
    STATUS_DRAFT_KIND as number,
    GRASP_LIST_KIND as number,
  ],
})
