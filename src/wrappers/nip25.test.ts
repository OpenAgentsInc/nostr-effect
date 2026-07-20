/**
 * NIP-25 Wrapper Tests (Pure helpers)
 */
import { describe, test, expect } from "bun:test"
import { finishReactionEvent, getReactedEventPointer, REACTION_KIND } from "./nip25.js"
import type { Event } from "./nip25.js"

const testPrivateKey = new Uint8Array([
  1, 35, 69, 103, 137, 171, 205, 239, 173, 205, 159, 37, 223, 225, 21, 13,
  205, 47, 129, 163, 239, 249, 23, 235, 221, 225, 151, 161, 55, 0, 111, 77
]) // test vector privkey

const createReactedEvent = (): Event => ({
  id: "abc123",
  pubkey: "17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6571f2d0d0ca0",
  created_at: 1234567890,
  kind: 1,
  tags: [
    ["e", "previousevent"],
    ["p", "previouspubkey"],
  ],
  content: "Hello",
  sig: "testsig",
})

describe("NIP-25 Pure Helpers", () => {
  test("REACTION_KIND is 7", () => {
    expect(REACTION_KIND as number).toBe(7)
  })

  test("finishReactionEvent creates correct structure", () => {
    const reacted = createReactedEvent()
    const template = { created_at: 1234567891, content: "👍" }
    const reaction = finishReactionEvent(template, reacted, testPrivateKey)

    expect(reaction.kind).toBe(REACTION_KIND)
    expect(reaction.content).toBe("👍")

    // Target e/p + k (spec: other e/p from source not recommended)
    const eTags = reaction.tags.filter((t) => t[0] === "e")
    const pTags = reaction.tags.filter((t) => t[0] === "p")
    expect(eTags).toHaveLength(1)
    expect(pTags).toHaveLength(1)
    expect(eTags[0]![1]).toBe(reacted.id)
    expect(pTags[0]![1]).toBe(reacted.pubkey)
    expect(reaction.tags.some((t) => t[0] === "k" && t[1] === "1")).toBe(true)
  })

  test("finishReactionEvent uses default content", () => {
    const reacted = createReactedEvent()
    const reaction = finishReactionEvent({ created_at: 1234567891 }, reacted, testPrivateKey)

    expect(reaction.content).toBe("+")
  })

  test("getReactedEventPointer extracts from reaction", () => {
    const reaction: Event = {
      id: "reactionid",
      pubkey: "reactionpub",
      created_at: 1234567891,
      kind: REACTION_KIND,
      tags: [
        ["e", "eventid123", "wss://relay1.com"],
        ["p", "pubkey123", "wss://relay2.com"],
        ["other", "tag"],
      ],
      content: "+",
      sig: "sig",
    }

    const pointer = getReactedEventPointer(reaction as any)
    expect(pointer).toBeDefined()
    expect(pointer!.id).toBe("eventid123")
    expect(pointer!.author).toBe("pubkey123")
    expect(pointer!.relays).toContain("wss://relay1.com")
    expect(pointer!.relays).toContain("wss://relay2.com")
  })

  test("getReactedEventPointer uses last e/p tags", () => {
    const reaction: Event = {
      id: "reactionid",
      pubkey: "reactionpub",
      created_at: 1234567891,
      kind: REACTION_KIND,
      tags: [
        ["e", "first"],
        ["p", "firstp"],
        ["middle", "tags"],
        ["e", "laste"],
        ["p", "lastp"],
      ],
      content: "+",
      sig: "sig",
    }

    const pointer = getReactedEventPointer(reaction as any)!
    expect(pointer.id).toBe("laste")
    expect(pointer.author).toBe("lastp")
  })

  test("getReactedEventPointer returns undefined for invalid", () => {
    const nonReaction: Event = createReactedEvent()
    expect(getReactedEventPointer(nonReaction as any)).toBeUndefined()

    const noETag: Event = {
      ...createReactedEvent(),
      kind: REACTION_KIND,
      tags: [["p", "pub"]],
    }
    expect(getReactedEventPointer(noETag as any)).toBeUndefined()

    const noPTag: Event = {
      ...createReactedEvent(),
      kind: REACTION_KIND,
      tags: [["e", "id"]],
    }
    expect(getReactedEventPointer(noPTag as any)).toBeUndefined()
  })
})
