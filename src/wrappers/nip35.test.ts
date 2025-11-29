/**
 * Tests for NIP-35 Torrents
 */
import { describe, test, expect } from "bun:test"
import { generateSecretKey, verifyEvent } from "./pure.js"
import { signTorrentEvent, magnetFromTorrent, signTorrentComment, TorrentKind, TorrentCommentKind } from "./nip35.js"

describe("NIP-35 Torrents", () => {
  test("build and sign torrent event and magnet link", () => {
    const sk = generateSecretKey()
    const evt = signTorrentEvent({
      title: "Example Torrent",
      infoHash: "a".repeat(40),
      description: "A sample torrent",
      files: [
        { path: "info/example.txt", sizeBytes: 1234 },
        { path: "info/sub/other.bin" },
      ],
      trackers: ["udp://tracker.example:1337", "http://tracker2/announce"],
      externals: [
        { value: "tcat:video,movie,4k" },
        { value: "imdb:tt15239678" },
      ],
      hashtags: ["movie", "4k"],
    }, sk)

    expect(evt.kind).toBe(TorrentKind)
    const title = evt.tags.find((t) => t[0] === "title")?.[1]
    const x = evt.tags.find((t) => t[0] === "x")?.[1]
    const file = evt.tags.find((t) => t[0] === "file")
    const ext = evt.tags.find((t) => t[0] === "i")
    expect(title).toBe("Example Torrent")
    expect(x).toBe("a".repeat(40))
    expect(file?.[1]).toBe("info/example.txt")
    expect(ext?.[1]).toContain("tcat:")
    expect(verifyEvent(evt)).toBe(true)

    const magnet = magnetFromTorrent(evt)
    expect(magnet.startsWith("magnet:?xt=urn:btih:")).toBe(true)
    expect(magnet).toContain("&tr=")
  })

  test("build and sign torrent comment (kind 2004)", () => {
    const sk = generateSecretKey()
    const parent = signTorrentEvent({ title: "T", infoHash: "b".repeat(40) }, generateSecretKey())
    const comment = signTorrentComment({ parentId: parent.id, parentAuthor: parent.pubkey, content: "Nice!", relayHint: "wss://relay.example" }, sk)
    expect(comment.kind).toBe(TorrentCommentKind)
    const e = comment.tags.find((t) => t[0] === "e")
    const p = comment.tags.find((t) => t[0] === "p")
    expect(e?.[1]).toBe(parent.id)
    expect(p?.[1]).toBe(parent.pubkey)
    expect(verifyEvent(comment)).toBe(true)
  })
})
