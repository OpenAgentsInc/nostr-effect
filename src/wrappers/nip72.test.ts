/**
 * Tests for NIP-72 Moderated Communities
 */
import { describe, test, expect } from "bun:test"
import { generateSecretKey, getPublicKey, verifyEvent } from "./pure.js"
import {
  CommunityDefinitionKind,
  CommunityPostKind,
  CommunityApprovalKind,
  signCommunityDefinition,
  signCommunityPost,
  signCommunityApproval,
} from "./nip72.js"

describe("NIP-72 Moderated Communities", () => {
  test("build and sign community definition with moderators and relays", () => {
    const ownerSk = generateSecretKey()
    const mod1 = getPublicKey(generateSecretKey())
    const mod2 = getPublicKey(generateSecretKey())

    const evt = signCommunityDefinition({
      d: "my-community",
      name: "My Community",
      description: "Welcome!",
      image: { url: "https://img.example/logo.png", size: "512x512" },
      moderators: [
        { pubkey: mod1, relay: "wss://relay.mods" },
        { pubkey: mod2 },
      ],
      relays: [
        { url: "wss://relay.author", marker: "author" },
        { url: "wss://relay.requests", marker: "requests" },
        { url: "wss://relay.approvals", marker: "approvals" },
      ],
    }, ownerSk)

    expect(evt.kind).toBe(CommunityDefinitionKind)
    const dTag = evt.tags.find((t) => t[0] === "d")
    expect(dTag?.[1]).toBe("my-community")
    const pModerator = evt.tags.filter((t) => t[0] === "p")
    expect(pModerator.length).toBe(2)
    expect(pModerator[0]?.[3]).toBe("moderator")
    expect(verifyEvent(evt)).toBe(true)
  })

  test("build and sign top‑level community post tags (A/a, P/p, K/k)", () => {
    const ownerSk = generateSecretKey()
    const ownerPk = getPublicKey(ownerSk)
    const postSk = generateSecretKey()
    // ensure builder signatures are valid
    const evt = signCommunityPost({ community: { ownerPubkey: ownerPk, d: "my-comm", relay: "wss://r" }, content: "hello" }, postSk)
    expect(evt.kind).toBe(CommunityPostKind)
    const A = evt.tags.find((t) => t[0] === "A")
    const a = evt.tags.find((t) => t[0] === "a")
    const P = evt.tags.find((t) => t[0] === "P")
    const p = evt.tags.find((t) => t[0] === "p")
    const K = evt.tags.find((t) => t[0] === "K")
    const k = evt.tags.find((t) => t[0] === "k")
    expect(A?.[1]).toBe(`${CommunityDefinitionKind}:${ownerPk}:my-comm`)
    expect(a?.[1]).toBe(`${CommunityDefinitionKind}:${ownerPk}:my-comm`)
    expect(P?.[1]).toBe(ownerPk)
    expect(p?.[1]).toBe(ownerPk)
    expect(K?.[1]).toBe(String(CommunityDefinitionKind))
    expect(k?.[1]).toBe(String(CommunityDefinitionKind))
    expect(verifyEvent(evt)).toBe(true)
  })

  test("build and sign reply post tags (A/P/K + e/p/k)", () => {
    const ownerSk = generateSecretKey()
    const ownerPk = getPublicKey(ownerSk)
    const authorSk = generateSecretKey()
    // authorPk available if needed
    const parent = signCommunityPost({ community: { ownerPubkey: ownerPk, d: "my-comm" }, content: "root" }, authorSk)

    const reply = signCommunityPost({
      community: { ownerPubkey: ownerPk, d: "my-comm" },
      parentEventId: parent.id,
      parentAuthorPubkey: parent.pubkey,
      parentKind: parent.kind,
      content: "reply",
    }, authorSk)

    expect(reply.kind).toBe(CommunityPostKind)
    expect(reply.tags.find((t) => t[0] === "A")?.[1]).toBe(`${CommunityDefinitionKind}:${ownerPk}:my-comm`)
    expect(reply.tags.find((t) => t[0] === "e")?.[1]).toBe(parent.id)
    expect(reply.tags.find((t) => t[0] === "p")?.[1]).toBe(parent.pubkey)
    expect(reply.tags.find((t) => t[0] === "k")?.[1]).toBe(String(parent.kind))
    expect(verifyEvent(reply)).toBe(true)
  })

  test("build and sign approval event (kind 4550)", () => {
    const ownerSk = generateSecretKey()
    const ownerPk = getPublicKey(ownerSk)
    const authorSk = generateSecretKey()
    const authorPk = getPublicKey(authorSk)
    const post = signCommunityPost({ community: { ownerPubkey: ownerPk, d: "my-comm" }, content: "post" }, authorSk)

    const approval = signCommunityApproval({
      community: { ownerPubkey: ownerPk, d: "my-comm" },
      post,
      postAuthorPubkey: authorPk,
      postRequestKind: post.kind,
    }, ownerSk)

    expect(approval.kind).toBe(CommunityApprovalKind)
    const a = approval.tags.find((t) => t[0] === "a")
    const e = approval.tags.find((t) => t[0] === "e")
    const p = approval.tags.find((t) => t[0] === "p")
    const k = approval.tags.find((t) => t[0] === "k")
    expect(a?.[1]).toBe(`${CommunityDefinitionKind}:${ownerPk}:my-comm`)
    expect(e?.[1]).toBe(post.id)
    expect(p?.[1]).toBe(authorPk)
    expect(k?.[1]).toBe(String(post.kind))
    // content should be JSON of the post if not overridden
    expect(() => JSON.parse(approval.content)).not.toThrow()
    expect(verifyEvent(approval)).toBe(true)
  })
})
