/**
 * Tests for NIP-26 Delegated Event Signing
 */
import { describe, test, expect } from "bun:test"
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from "./pure.js"
import {
  createDelegationTag,
  verifyDelegationTag,
  finalizeDelegatedEvent,
  verifyDelegatedEvent,
  type DelegationTag,
} from "./nip26.js"

describe("NIP-26 Delegation", () => {
  test("create and verify delegation tag", () => {
    const delegatorSk = generateSecretKey()
    const delegatorPk = getPublicKey(delegatorSk)
    const delegateSk = generateSecretKey()
    const delegatePk = getPublicKey(delegateSk)

    const conditions = "kind=1&created_at<4102444800" // year 2100

    const tag = createDelegationTag(delegatorSk, delegatePk, conditions)
    expect(tag[0]).toBe("delegation")
    expect(tag[1]).toBe(delegatorPk)
    expect(tag[2]).toBe(conditions)
    expect(tag[3].length).toBe(128)

    expect(verifyDelegationTag(tag, delegatePk)).toBe(true)

    // tamper conditions should fail
    const bad: DelegationTag = [tag[0], tag[1], "kind=1", tag[3]]
    expect(verifyDelegationTag(bad, delegatePk)).toBe(false)
  })

  test("delegated event signs with delegate and includes delegation tag", () => {
    const delegatorSk = generateSecretKey()
    const delegateSk = generateSecretKey()
    const delegatePk = getPublicKey(delegateSk)
    const conditions = "kind=1&created_at<4102444800"

    const tag = createDelegationTag(delegatorSk, delegatePk, conditions)

    const template = {
      kind: 1,
      content: "hello from delegate",
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
    }

    const delegated = finalizeDelegatedEvent(template, delegateSk, tag)
    expect(delegated.pubkey).toBe(delegatePk)
    expect(verifyDelegatedEvent(delegated)).toBe(true)

    // regular event verification should succeed too
    expect(verifyEvent(delegated)).toBe(true)
  })

  test("verifyDelegatedEvent fails when delegation tag is missing or invalid", () => {
    const delegatorSk = generateSecretKey()
    const delegateSk = generateSecretKey()
    const delegatePk = getPublicKey(delegateSk)
    const conditions = "kind=1"
    const tag = createDelegationTag(delegatorSk, delegatePk, conditions)

    const template = {
      kind: 1,
      content: "no tag",
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
    }
    const signed = finalizeEvent(template, delegateSk)

    // Missing delegation tag
    expect(verifyDelegatedEvent(signed)).toBe(false)

    // Add tag but tamper signature
    const tamperedTag: DelegationTag = ["delegation", tag[1], tag[2], "f".repeat(128)]
    const delegated = finalizeDelegatedEvent(template, delegateSk, tamperedTag)
    expect(verifyDelegatedEvent(delegated)).toBe(false)
  })
})
