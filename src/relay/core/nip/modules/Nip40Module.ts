import { Effect } from "effect"
import { createModule, type NipModule } from "../NipModule.js"
import { isEventExpired } from "../../../../core/Nip40.js"

/**
 * NIP-40: Expiration Timestamp
 * - Rejects events that are already expired at submission time
 * - Advertises support in NIP-11 via the module registry
 */
export const Nip40Module: NipModule = createModule({
  id: "nip-40",
  nips: [40],
  description: "Expiration timestamp handling; reject expired submissions.",
  kinds: [],
  policies: [
    (ctx) =>
      Effect.succeed(
        isEventExpired(ctx.event as any)
          ? { _tag: "Reject", reason: "invalid: expired" }
          : { _tag: "Accept" }
      ),
  ],
})
