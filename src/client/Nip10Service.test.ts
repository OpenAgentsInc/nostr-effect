/**
 * NIP-10: Thread/Reply Parsing Tests
 */
import { describe, test, expect } from "bun:test"
import { parse, isReply, isRoot, getReplyToId, getRootId } from "./Nip10Service.js"

describe("NIP-10: Thread/Reply Parsing", () => {
  describe("parse() with marked tags", () => {
    test("should parse root tag", () => {
      const event = {
        tags: [
          ["e", "rootid123", "wss://relay.example.com", "root"],
          ["p", "pubkey123", "wss://relay.example.com"],
        ],
      }
      const result = parse(event)
      expect(result.root?.id).toBe("rootid123")
      expect(result.root?.relays).toEqual(["wss://relay.example.com"])
    })

    test("should parse reply tag", () => {
      const event = {
        tags: [
          ["e", "rootid123", "wss://relay.example.com", "root"],
          ["e", "replyid123", "wss://relay2.example.com", "reply"],
          ["p", "pubkey123"],
        ],
      }
      const result = parse(event)
      expect(result.root?.id).toBe("rootid123")
      expect(result.reply?.id).toBe("replyid123")
    })

    test("should parse mention tags", () => {
      const event = {
        tags: [
          ["e", "rootid123", "", "root"],
          ["e", "mentionid", "", "mention"],
          ["e", "replyid", "", "reply"],
        ],
      }
      const result = parse(event)
      expect(result.mentions).toHaveLength(1)
      expect(result.mentions[0]?.id).toBe("mentionid")
    })

    test("should parse quote tags", () => {
      const event = {
        tags: [
          ["e", "rootid123", "", "root"],
          ["q", "quoteid123", "wss://relay.example.com"],
        ],
      }
      const result = parse(event)
      expect(result.quotes).toHaveLength(1)
      expect(result.quotes[0]?.id).toBe("quoteid123")
    })

    test("should parse profile tags", () => {
      const event = {
        tags: [
          ["p", "pubkey1", "wss://relay1.example.com"],
          ["p", "pubkey2", "wss://relay2.example.com"],
        ],
      }
      const result = parse(event)
      expect(result.profiles).toHaveLength(2)
      // Note: profiles are collected in reverse order due to reverse iteration
      const pubkeys = result.profiles.map((p) => p.pubkey)
      expect(pubkeys).toContain("pubkey1")
      expect(pubkeys).toContain("pubkey2")
    })

    test("should parse author in e-tag", () => {
      const event = {
        tags: [["e", "eventid", "wss://relay.example.com", "root", "authorpubkey"]],
      }
      const result = parse(event)
      expect(result.root?.author).toBe("authorpubkey")
    })
  })

  describe("parse() with legacy positional tags", () => {
    test("should treat single e-tag as root and reply", () => {
      const event = {
        tags: [["e", "eventid123", "wss://relay.example.com"]],
      }
      const result = parse(event)
      expect(result.root?.id).toBe("eventid123")
      expect(result.reply?.id).toBe("eventid123")
    })

    test("should treat first e-tag as root, last as reply", () => {
      const event = {
        tags: [
          ["e", "rootid123"],
          ["e", "replyid123"],
        ],
      }
      const result = parse(event)
      expect(result.root?.id).toBe("rootid123")
      expect(result.reply?.id).toBe("replyid123")
    })

    test("should treat middle e-tags as mentions", () => {
      const event = {
        tags: [
          ["e", "rootid123"],
          ["e", "mentionid123"],
          ["e", "replyid123"],
        ],
      }
      const result = parse(event)
      expect(result.root?.id).toBe("rootid123")
      expect(result.reply?.id).toBe("replyid123")
      expect(result.mentions.some((m) => m.id === "mentionid123")).toBe(true)
    })
  })

  describe("parse() relay hint inheritance", () => {
    test("should inherit relay hints from author profiles", () => {
      const event = {
        tags: [
          ["e", "eventid", "", "root", "authorpubkey"],
          ["p", "authorpubkey", "wss://author-relay.example.com"],
        ],
      }
      const result = parse(event)
      expect(result.root?.relays).toContain("wss://author-relay.example.com")
    })
  })

  describe("isReply()", () => {
    test("should return true for reply events", () => {
      const event = { tags: [["e", "parentid", "", "reply"]] }
      expect(isReply(event)).toBe(true)
    })

    test("should return true for events with root only", () => {
      const event = { tags: [["e", "rootid", "", "root"]] }
      expect(isReply(event)).toBe(true)
    })

    test("should return false for root events", () => {
      const event = { tags: [] }
      expect(isReply(event)).toBe(false)
    })
  })

  describe("isRoot()", () => {
    test("should return true for root events", () => {
      const event = { tags: [] }
      expect(isRoot(event)).toBe(true)
    })

    test("should return false for reply events", () => {
      const event = { tags: [["e", "parentid", "", "reply"]] }
      expect(isRoot(event)).toBe(false)
    })
  })

  describe("getReplyToId()", () => {
    test("should return reply id if present", () => {
      const event = {
        tags: [
          ["e", "rootid", "", "root"],
          ["e", "replyid", "", "reply"],
        ],
      }
      expect(getReplyToId(event)).toBe("replyid")
    })

    test("should return root id if no reply", () => {
      const event = { tags: [["e", "rootid", "", "root"]] }
      expect(getReplyToId(event)).toBe("rootid")
    })

    test("should return undefined for root events", () => {
      const event = { tags: [] }
      expect(getReplyToId(event)).toBeUndefined()
    })
  })

  describe("getRootId()", () => {
    test("should return root id", () => {
      const event = {
        tags: [
          ["e", "rootid", "", "root"],
          ["e", "replyid", "", "reply"],
        ],
      }
      expect(getRootId(event)).toBe("rootid")
    })

    test("should return undefined for root events", () => {
      const event = { tags: [] }
      expect(getRootId(event)).toBeUndefined()
    })
  })
})
