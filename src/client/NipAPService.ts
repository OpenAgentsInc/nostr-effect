/**
 * NipAPService
 *
 * NIP-AP: Agent Personas
 *
 * Plaintext addressable persona blueprints. A `kind:30175` event is a public,
 * addressable definition that describes how to instantiate an AI agent
 * (identity, behavioral configuration, and an optional name pool). It is the
 * "blueprint" from which agents are spawned. A `kind:30177` event is the
 * per-instance state projection, keyed by the agent (instance) pubkey via its
 * `d` tag.
 *
 * Both kinds live in the NIP-33 parameterized replaceable range
 * (30000-39999): addressed by `(pubkey, kind, d_tag)`, with only the latest
 * event per address retained. Content is plaintext (unencrypted) JSON — no new
 * crypto. Secrets MUST NOT appear in persona content; convey them through a
 * separate encrypted channel (e.g. a NIP-AE `mem/persona` engram).
 *
 * @see ~/work/projects/repos/buzz/docs/nips/NIP-AP.md
 */
import { Context, Effect, Layer, Option, Schema, Stream } from "effect"
import { RelayService, type PublishResult } from "./RelayService.js"
import { EventService } from "../services/EventService.js"
import { RelayError } from "../core/Errors.js"
import { EventKind, Filter, Tag, type NostrEvent, type PrivateKey, type PublicKey } from "../core/Schema.js"
import { AgentInstanceState, AgentPersona } from "../wrappers/kinds.js"

const decodeKind = Schema.decodeSync(EventKind)
const decodeFilter = Schema.decodeSync(Filter)
const decodeTag = Schema.decodeSync(Tag)

// =============================================================================
// Constants
// =============================================================================

/** Persona blueprint kind (addressable, plaintext). */
export const PERSONA_KIND = AgentPersona // 30175
/** Per-instance state kind (addressable, plaintext). */
export const INSTANCE_STATE_KIND = AgentInstanceState // 30177

/** Persona slug grammar per NIP-AP: `^[a-z0-9][a-z0-9_-]{0,63}$`, 1-64 bytes. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** Maximum serialized content body size per NIP-AP (65,535 bytes). */
export const MAX_CONTENT_BYTES = 65535

/** NIP-31 alt summary for unknown-kind viewers. */
const PERSONA_ALT = "agent persona definition"

// =============================================================================
// Tagged Errors
// =============================================================================

export class InvalidPersonaSlug extends Schema.TaggedErrorClass<InvalidPersonaSlug>()(
  "InvalidPersonaSlug",
  { message: Schema.String }
) {}

export class InvalidPersonaContent extends Schema.TaggedErrorClass<InvalidPersonaContent>()(
  "InvalidPersonaContent",
  { message: Schema.String }
) {}

export class PersonaContentTooLarge extends Schema.TaggedErrorClass<PersonaContentTooLarge>()(
  "PersonaContentTooLarge",
  { message: Schema.String }
) {}

// =============================================================================
// Content Schemas
// =============================================================================

/**
 * `kind:30175` persona blueprint content body (plaintext JSON).
 *
 * Only `display_name` is required. Unknown fields are ignored on decode
 * (forward compatibility). The behavioral fields (`respond_to`,
 * `respond_to_allowlist`, `parallelism`) are reserved: parsed and preserved at
 * the wire layer, not yet applied.
 */
export const PersonaEventContent = Schema.Struct({
  display_name: Schema.String,
  system_prompt: Schema.optional(Schema.NullOr(Schema.String)),
  avatar_url: Schema.optional(Schema.NullOr(Schema.String)),
  runtime: Schema.optional(Schema.NullOr(Schema.String)),
  model: Schema.optional(Schema.NullOr(Schema.String)),
  provider: Schema.optional(Schema.NullOr(Schema.String)),
  name_pool: Schema.optional(Schema.Array(Schema.String)),
  respond_to: Schema.optional(Schema.NullOr(Schema.String)),
  respond_to_allowlist: Schema.optional(Schema.Array(Schema.String)),
  parallelism: Schema.optional(Schema.NullOr(Schema.Number)),
})
export type PersonaEventContent = Schema.Schema.Type<typeof PersonaEventContent>

/**
 * `kind:30177` per-instance state content body (plaintext JSON).
 *
 * Keyed by the agent (instance) pubkey via the `d` tag. Instance-level fields
 * are always present for a live instance. Definition-level fields
 * (`system_prompt`, `model`, `provider`, `persona_source_version`) are emitted
 * only for definition-less instances (an instance with no linked definition is
 * its own definition); for definition-linked instances they resolve through the
 * linked `kind:30175` head and MUST NOT be emitted. Readers tolerate legacy
 * "fat" events during the transition; where both carry a field the 30175 head
 * is authoritative.
 */
export const InstanceStateContent = Schema.Struct({
  // Instance-level fields
  name: Schema.optional(Schema.NullOr(Schema.String)),
  definition_id: Schema.optional(Schema.NullOr(Schema.String)),
  respond_to: Schema.optional(Schema.NullOr(Schema.String)),
  respond_to_allowlist: Schema.optional(Schema.Array(Schema.String)),
  parallelism: Schema.optional(Schema.NullOr(Schema.Number)),
  // Definition-level fields (definition-less instances only)
  system_prompt: Schema.optional(Schema.NullOr(Schema.String)),
  model: Schema.optional(Schema.NullOr(Schema.String)),
  provider: Schema.optional(Schema.NullOr(Schema.String)),
  persona_source_version: Schema.optional(Schema.NullOr(Schema.Number)),
})
export type InstanceStateContent = Schema.Schema.Type<typeof InstanceStateContent>

const decodePersonaContent = Schema.decodeUnknownEffect(PersonaEventContent)
const decodeInstanceStateContent = Schema.decodeUnknownEffect(InstanceStateContent)

// =============================================================================
// Pure helpers (build / parse) — no signing, no relay
// =============================================================================

/** Validate a persona slug against the NIP-AP grammar. */
export const validateSlug = (slug: string): Effect.Effect<string, InvalidPersonaSlug> =>
  SLUG_PATTERN.test(slug)
    ? Effect.succeed(slug)
    : Effect.fail(
        new InvalidPersonaSlug({
          message: `Invalid persona slug ${JSON.stringify(slug)}: must match ${SLUG_PATTERN.source}`,
        })
      )

/** Addressable `a`-tag identifier for a persona: `30175:<pubkey>:<slug>`. */
export const personaAddress = (author: PublicKey, slug: string): string =>
  `${PERSONA_KIND}:${author}:${slug}`

/**
 * Serialize a persona content body to its plaintext JSON string.
 * Emits fields in NIP-AP order, omitting `undefined` fields. Rejects bodies
 * whose serialized form exceeds {@link MAX_CONTENT_BYTES}.
 */
export const buildPersonaContent = (
  content: PersonaEventContent
): Effect.Effect<string, InvalidPersonaContent | PersonaContentTooLarge> =>
  Effect.gen(function* () {
    if (typeof content.display_name !== "string" || content.display_name.length === 0) {
      return yield* Effect.fail(
        new InvalidPersonaContent({ message: "persona content requires a non-empty display_name" })
      )
    }
    const ordered: Record<string, unknown> = { display_name: content.display_name }
    const keys = [
      "system_prompt",
      "avatar_url",
      "runtime",
      "model",
      "provider",
      "name_pool",
      "respond_to",
      "respond_to_allowlist",
      "parallelism",
    ] as const
    for (const k of keys) {
      const v = (content as Record<string, unknown>)[k]
      if (v !== undefined) ordered[k] = v
    }
    const json = JSON.stringify(ordered)
    const bytes = new TextEncoder().encode(json).length
    if (bytes > MAX_CONTENT_BYTES) {
      return yield* Effect.fail(
        new PersonaContentTooLarge({
          message: `persona content is ${bytes} bytes, exceeds ${MAX_CONTENT_BYTES}`,
        })
      )
    }
    return json
  })

/** Parse a plaintext persona content string into a typed body. */
export const parsePersonaContent = (
  raw: string
): Effect.Effect<PersonaEventContent, InvalidPersonaContent> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: (e) => new InvalidPersonaContent({ message: `content is not valid JSON: ${String(e)}` }),
    })
    return yield* decodePersonaContent(parsed).pipe(
      Effect.mapError((e) => new InvalidPersonaContent({ message: String(e) }))
    )
  })

/** Serialize an instance-state content body to plaintext JSON. */
export const buildInstanceStateContent = (
  content: InstanceStateContent
): Effect.Effect<string, PersonaContentTooLarge> =>
  Effect.gen(function* () {
    const ordered: Record<string, unknown> = {}
    const keys = [
      "name",
      "definition_id",
      "respond_to",
      "respond_to_allowlist",
      "parallelism",
      "system_prompt",
      "model",
      "provider",
      "persona_source_version",
    ] as const
    for (const k of keys) {
      const v = (content as Record<string, unknown>)[k]
      if (v !== undefined) ordered[k] = v
    }
    const json = JSON.stringify(ordered)
    const bytes = new TextEncoder().encode(json).length
    if (bytes > MAX_CONTENT_BYTES) {
      return yield* Effect.fail(
        new PersonaContentTooLarge({
          message: `instance state content is ${bytes} bytes, exceeds ${MAX_CONTENT_BYTES}`,
        })
      )
    }
    return json
  })

/** Parse a plaintext instance-state content string into a typed body. */
export const parseInstanceStateContent = (
  raw: string
): Effect.Effect<InstanceStateContent, InvalidPersonaContent> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: (e) => new InvalidPersonaContent({ message: `content is not valid JSON: ${String(e)}` }),
    })
    return yield* decodeInstanceStateContent(parsed).pipe(
      Effect.mapError((e) => new InvalidPersonaContent({ message: String(e) }))
    )
  })

// =============================================================================
// Service
// =============================================================================

export interface BuildPersonaOptions {
  readonly slug: string
  readonly content: PersonaEventContent
  readonly createdAt?: number
}

export interface GetPersonaOptions {
  readonly author: PublicKey
  readonly slug: string
  readonly timeoutMs?: number
}

export interface ListPersonasOptions {
  readonly author: PublicKey
  readonly limit?: number
  readonly timeoutMs?: number
}

/** A parsed persona: its NIP-33 address parts plus the decoded content body. */
export interface ParsedPersona {
  readonly author: PublicKey
  readonly slug: string
  readonly content: PersonaEventContent
  readonly event: NostrEvent
}

export interface PublishInstanceStateOptions {
  /** Agent (instance) pubkey — becomes the `d` tag. */
  readonly agentPubkey: string
  readonly content: InstanceStateContent
  readonly createdAt?: number
}

export interface GetInstanceStateOptions {
  readonly author: PublicKey
  readonly agentPubkey: string
  readonly timeoutMs?: number
}

export interface ParsedInstanceState {
  readonly author: PublicKey
  readonly agentPubkey: string
  readonly content: InstanceStateContent
  readonly event: NostrEvent
}

export interface NipAPService {
  readonly _tag: "NipAPService"

  /** Build a signed (but unpublished) persona event. */
  buildPersona(
    options: BuildPersonaOptions,
    privateKey: PrivateKey
  ): Effect.Effect<NostrEvent, InvalidPersonaSlug | InvalidPersonaContent | PersonaContentTooLarge | RelayError>

  /** Parse a persona event into its address parts and typed content body. */
  parsePersona(
    event: NostrEvent
  ): Effect.Effect<ParsedPersona, InvalidPersonaSlug | InvalidPersonaContent>

  /** Build, sign, and publish a persona event. */
  publishPersona(
    options: BuildPersonaOptions,
    privateKey: PrivateKey
  ): Effect.Effect<PublishResult, InvalidPersonaSlug | InvalidPersonaContent | PersonaContentTooLarge | RelayError>

  /** Read a single persona head by `(author, slug)`. */
  getPersona(options: GetPersonaOptions): Effect.Effect<NostrEvent | null, RelayError>

  /** List all persona heads for an owner. */
  listPersonas(options: ListPersonasOptions): Effect.Effect<readonly NostrEvent[], RelayError>

  /** Build, sign, and publish a per-instance `kind:30177` state event. */
  publishInstanceState(
    options: PublishInstanceStateOptions,
    privateKey: PrivateKey
  ): Effect.Effect<PublishResult, PersonaContentTooLarge | RelayError>

  /** Parse an instance-state event into its address parts and typed body. */
  parseInstanceState(
    event: NostrEvent
  ): Effect.Effect<ParsedInstanceState, InvalidPersonaSlug | InvalidPersonaContent>

  /** Read a single instance-state head by `(author, agentPubkey)`. */
  getInstanceState(options: GetInstanceStateOptions): Effect.Effect<NostrEvent | null, RelayError>
}

export const NipAPService = Context.Service<NipAPService>("NipAPService")

const dTagValue = (event: NostrEvent): string | undefined =>
  event.tags.find((t) => t[0] === "d")?.[1]

const make = Effect.gen(function* () {
  const relay = yield* RelayService
  const events = yield* EventService

  const buildPersona: NipAPService["buildPersona"] = (options, privateKey) =>
    Effect.gen(function* () {
      const slug = yield* validateSlug(options.slug)
      const content = yield* buildPersonaContent(options.content)
      const tags: string[][] = [
        ["d", slug],
        ["alt", PERSONA_ALT],
      ]
      const event = yield* events.createEvent(
        {
          kind: decodeKind(PERSONA_KIND),
          content,
          tags: tags.map((t) => decodeTag(t)),
          created_at: (options.createdAt ?? undefined) as never,
        },
        privateKey
      ).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))
      return event
    })

  const parsePersona: NipAPService["parsePersona"] = (event) =>
    Effect.gen(function* () {
      const d = dTagValue(event)
      if (d === undefined) {
        return yield* Effect.fail(new InvalidPersonaSlug({ message: "persona event is missing its d tag" }))
      }
      const slug = yield* validateSlug(d)
      const content = yield* parsePersonaContent(event.content)
      return { author: event.pubkey as PublicKey, slug, content, event }
    })

  const publishPersona: NipAPService["publishPersona"] = (options, privateKey) =>
    Effect.gen(function* () {
      const event = yield* buildPersona(options, privateKey)
      return yield* relay.publish(event).pipe(
        Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url }))
      )
    })

  const getPersona: NipAPService["getPersona"] = ({ author, slug, timeoutMs }) =>
    Effect.gen(function* () {
      const filter = decodeFilter({ kinds: [decodeKind(PERSONA_KIND)], authors: [author], "#d": [slug], limit: 1 })
      const sub = yield* relay.subscribe([filter])
      const budget = timeoutMs && timeoutMs > 0 ? timeoutMs : 600
      const maybe = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(budget).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catch(() => Effect.succeed(Option.none<NostrEvent>())))
      yield* sub.unsubscribe()
      return Option.isSome(maybe) ? maybe.value : null
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const listPersonas: NipAPService["listPersonas"] = ({ author, limit, timeoutMs }) =>
    Effect.gen(function* () {
      const filter = decodeFilter({ kinds: [decodeKind(PERSONA_KIND)], authors: [author], limit })
      const sub = yield* relay.subscribe([filter])
      const acc: NostrEvent[] = []
      const max = limit && limit > 0 ? limit : 20
      const budget = timeoutMs && timeoutMs > 0 ? timeoutMs : 800

      const loop = Effect.gen(function* () {
        let count = 0
        while (count < max) {
          const next = yield* Effect.race(
            sub.events.pipe(Stream.runHead),
            Effect.sleep(60).pipe(Effect.as(Option.none<NostrEvent>()))
          ).pipe(Effect.catch(() => Effect.succeed(Option.none<NostrEvent>())))
          if (Option.isNone(next)) break
          acc.push(next.value)
          count++
        }
      })

      yield* Effect.race(loop, Effect.sleep(budget))
      yield* sub.unsubscribe()
      return acc
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  const publishInstanceState: NipAPService["publishInstanceState"] = (options, privateKey) =>
    Effect.gen(function* () {
      const content = yield* buildInstanceStateContent(options.content)
      const tags: string[][] = [
        ["d", options.agentPubkey],
        ["alt", "agent instance state"],
      ]
      const event = yield* events.createEvent(
        {
          kind: decodeKind(INSTANCE_STATE_KIND),
          content,
          tags: tags.map((t) => decodeTag(t)),
          created_at: (options.createdAt ?? undefined) as never,
        },
        privateKey
      ).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))
      return yield* relay.publish(event).pipe(
        Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url }))
      )
    })

  const parseInstanceState: NipAPService["parseInstanceState"] = (event) =>
    Effect.gen(function* () {
      const d = dTagValue(event)
      if (d === undefined || d.length === 0) {
        return yield* Effect.fail(new InvalidPersonaSlug({ message: "instance state event is missing its d tag" }))
      }
      const content = yield* parseInstanceStateContent(event.content)
      return { author: event.pubkey as PublicKey, agentPubkey: d, content, event }
    })

  const getInstanceState: NipAPService["getInstanceState"] = ({ author, agentPubkey, timeoutMs }) =>
    Effect.gen(function* () {
      const filter = decodeFilter({
        kinds: [decodeKind(INSTANCE_STATE_KIND)],
        authors: [author],
        "#d": [agentPubkey],
        limit: 1,
      })
      const sub = yield* relay.subscribe([filter])
      const budget = timeoutMs && timeoutMs > 0 ? timeoutMs : 600
      const maybe = yield* Effect.race(
        sub.events.pipe(Stream.runHead),
        Effect.sleep(budget).pipe(Effect.as(Option.none<NostrEvent>()))
      ).pipe(Effect.catch(() => Effect.succeed(Option.none<NostrEvent>())))
      yield* sub.unsubscribe()
      return Option.isSome(maybe) ? maybe.value : null
    }).pipe(Effect.mapError((e) => new RelayError({ message: String(e), relay: relay.url })))

  return {
    _tag: "NipAPService" as const,
    buildPersona,
    parsePersona,
    publishPersona,
    getPersona,
    listPersonas,
    publishInstanceState,
    parseInstanceState,
    getInstanceState,
  }
})

export const NipAPServiceLive = Layer.effect(NipAPService, make)
