/**
 * NIP-49: Private Key Encryption Tests
 */
import { describe, test, expect } from "bun:test"
import { decrypt, encrypt, type KeySecurityByte } from "./Nip49.js"
import { hexToBytes } from "@noble/hashes/utils"

describe("NIP-49: Private Key Encryption", () => {
  describe("encrypt and decrypt", () => {
    test("should encrypt and decrypt with test vectors", () => {
      for (const [password, secret, logn, ksb, ncryptsec] of vectors) {
        const sec = hexToBytes(secret)
        const there = encrypt(sec, password, logn, ksb)
        const back = decrypt(there, password)
        const again = decrypt(ncryptsec, password)
        expect(back).toEqual(again)
        expect(again).toEqual(sec)
      }
    })

    test("should handle empty password", () => {
      const sec = hexToBytes("f7f2f77f98890885462764afb15b68eb5f69979c8046ecb08cad7c4ae6b221ab")
      const encrypted = encrypt(sec, "", 1, 0x00)
      const decrypted = decrypt(encrypted, "")
      expect(decrypted).toEqual(sec)
    })

    test("should handle unicode passwords", () => {
      const sec = hexToBytes("11b25a101667dd9208db93c0827c6bdad66729a5b521156a7e9d3b22b3ae8944")
      const password = "ÅΩẛ̣"
      const encrypted = encrypt(sec, password, 1, 0x01)
      const decrypted = decrypt(encrypted, password)
      expect(decrypted).toEqual(sec)
    })

    test("should throw on invalid bech32 string", () => {
      // "nsec1invalid" contains 'i' which is not a valid bech32 character
      expect(() => decrypt("nsec1invalid", "password")).toThrow("Unknown letter")
    })
  })
})

// Test vectors from nostr-tools
const vectors: [string, string, number, KeySecurityByte, string][] = [
  [
    ".ksjabdk.aselqwe",
    "14c226dbdd865d5e1645e72c7470fd0a17feb42cc87b750bab6538171b3a3f8a",
    1,
    0x00,
    "ncryptsec1qgqeya6cggg2chdaf48s9evsr0czq3dw059t2khf5nvmq03yeckywqmspcc037l9ajjsq2p08480afuc5hq2zq3rtt454c2epjqxcxll0eff3u7ln2t349t7rc04029q63u28mkeuj4tdazsqqk6p5ky",
  ],
  [
    "skjdaklrnçurbç l",
    "f7f2f77f98890885462764afb15b68eb5f69979c8046ecb08cad7c4ae6b221ab",
    2,
    0x01,
    "ncryptsec1qgp86t7az0u5w0wp8nrjnxu9xhullqt39wvfsljz8289gyxg0thrlzv3k40dsqu32vcqza3m7srzm27mkg929gmv6hv5ctay59jf0h8vsj5pjmylvupkdtvy7fy88et3fhe6m3d84t9m8j2umq0j75lw",
  ],
  [
    "777z7z7z7z7z7z7z",
    "11b25a101667dd9208db93c0827c6bdad66729a5b521156a7e9d3b22b3ae8944",
    3,
    0x02,
    "ncryptsec1qgpc7jmmzmds376r8slazywlagrm5eerlrx7njnjenweggq2atjl0h9vmpk8f9gad0tqy3pwch8e49kyj5qtehp4mjwpzlshx5f5cce8feukst08w52zf4a7gssdqvt3eselup7x4zzezlme3ydxpjaf",
  ],
]
