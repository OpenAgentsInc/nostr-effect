/**
 * NipC0Service
 *
 * NIP-C0: Code Snippets (kind 1337)
 * Build/publish snippet events with rich tags and query helpers.
 */
import { Context, Effect, Layer, Stream, Option } from "effect"
import { Schema } from "@effect/schema"
import { RelayService, type PublishResult } from "./RelayService.js"
import { EventService } from "../services/EventService.js"
import { RelayError } from "../core/Errors.js"
import { EventKind, Filter, Tag, type NostrEvent, type PrivateKey } from "../core/Schema.js"
import { CodeSnippet as CODE_SNIPPET_KIND } from "../wrappers/kinds.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)
const decodeTag = Schema.decodeSync(Tag)

export interface LicenseTag {
  readonly id: string
  readonly ref?: string
}

export interface PublishSnippetParams {
  readonly content: string
  readonly language?: string
  readonly name?: string
  readonly extension?: string
  readonly description?: string
  readonly runtime?: string
  readonly repo?: string
  readonly licenses?: readonly LicenseTag[]
  readonly deps?: readonly string[]
  readonly extraTags?: readonly string[][]
  readonly createdAt?: number // unix seconds for deterministic tests
}

export interface QueryByAuthorParams {
  readonly author: string
  readonly limit?: number
  readonly timeoutMs?: number
}

export interface NipC0Service {
  readonly _tag: "NipC0Service"

  publishSnippet(params: PublishSnippetParams, privateKey: PrivateKey): Effect.Effect<PublishResult, RelayError>

  listByAuthor(params: QueryByAuthorParams): Effect.Effect<readonly NostrEvent[], RelayError>
}

export const NipC0Service = Context.GenericTag<NipC0Service>("NipC0Service")

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const events = yield* EventService

  const publishSnippet: NipC0Service["publishSnippet"] = (params, privateKey) =>
    Effect.gen(function* () {
      const tags: string[][] = []
      if (params.language) tags.push(["l", params.language.toLowerCase()])
      if (params.name) tags.push(["name", params.name])
      if (params.extension) tags.push(["extension", params.extension.toLowerCase()])
      if (params.description) tags.push(["description", params.description])
      if (params.runtime) tags.push(["runtime", params.runtime])
      if (params.repo) tags.push(["repo", params.repo])
      if (params.licenses) {
        for (const lic of params.licenses) {
          tags.push(lic.ref ? ["license", lic.id, lic.ref] : ["license", lic.id])
        }
      }
      if (params.deps) for (const d of params.deps) tags.push(["dep", d])
      if (params.extraTags) tags.push(...params.extraTags.map((t) => t.slice()))

      const ev = yield* events.createEvent(
        {
          kind: decodeKind(CODE_SNIPPET_KIND),
          content: params.content,
          tags: tags.map((t) => decodeTag(t)),
          created_at: (params.createdAt ?? undefined) as any,
        },
        privateKey
      )
      return yield* relay.publish(ev)
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const listByAuthor: NipC0Service["listByAuthor"] = ({ author, limit, timeoutMs }) =>
    Effect.gen(function* () {
      const base: any = { kinds: [decodeKind(CODE_SNIPPET_KIND)], authors: [author] }
      if (limit) base.limit = limit
      const filter = decodeFilter(base)
      const sub = yield* relay.subscribe([filter])
      const results: NostrEvent[] = []
      const collect = Effect.gen(function* () {
        const next = yield* Effect.race(
          sub.events.pipe(Stream.runHead),
          Effect.sleep(timeoutMs ?? 600).pipe(Effect.as(Option.none<NostrEvent>()))
        ).pipe(Effect.catchAll(() => Effect.succeed(Option.none<NostrEvent>())))
        if (Option.isSome(next)) results.push(next.value)
      })
      const n = limit ?? 1
      for (let i = 0; i < n; i++) {
        // eslint-disable-next-line no-await-in-loop
        yield* collect
      }
      yield* sub.unsubscribe()
      return results
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  return {
    _tag: "NipC0Service" as const,
    publishSnippet,
    listByAuthor,
  }
})

export const NipC0ServiceLive = Layer.effect(NipC0Service, make)

