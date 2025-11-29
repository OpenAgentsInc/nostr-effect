import { test, expect, describe } from "bun:test"
import { withSubject, getSubject, replySubject } from "./nip14.js"

describe("NIP-14 subject tag helpers", () => {
  test("withSubject sets/replaces subject", () => {
    const tags: string[][] = [["t", "yak"]]
    const t1 = withSubject(tags as any, "Yak Talk")
    expect(t1.find((t) => t[0] === "subject")?.[1]).toBe("Yak Talk")
    const t2 = withSubject(t1 as any, "Yak Talk Updated")
    const subs = t2.filter((t) => t[0] === "subject")
    expect(subs.length).toBe(1)
    expect(subs[0]?.[1]).toBe("Yak Talk Updated")
  })

  test("getSubject returns value or null", () => {
    const event = {
      id: "e".repeat(64),
      pubkey: "a".repeat(64),
      created_at: 1,
      kind: 1,
      content: "hi",
      tags: [["subject", "Topic"], ["t", "yak"]],
      sig: "f".repeat(128),
    } as any
    expect(getSubject(event)).toBe("Topic")
    expect(getSubject({ ...event, tags: [["t", "yak"]] } as any)).toBeNull()
  })

  test("replySubject adorns with Re: ", () => {
    expect(replySubject("Topic")).toBe("Re: Topic")
    expect(replySubject("Re: Topic")).toBe("Re: Topic")
    expect(replySubject(null)).toBeNull()
  })
})

