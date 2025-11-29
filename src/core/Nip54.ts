/**
 * NIP-54: Wiki
 * https://github.com/nostr-protocol/nips/blob/master/54.md
 *
 * Wiki article identifier normalization
 */

/**
 * Normalize a wiki identifier
 * - Trims whitespace
 * - Converts to lowercase
 * - Normalizes Unicode to NFKC form
 * - Replaces non-alphanumeric characters with hyphens
 */
export function normalizeIdentifier(name: string): string {
  // Trim and lowercase
  name = name.trim().toLowerCase()

  // Normalize Unicode to NFKC form
  name = name.normalize("NFKC")

  // Convert to array of characters and map each one
  return Array.from(name)
    .map((char) => {
      // Check if character is letter or number using Unicode ranges
      if (/\p{Letter}/u.test(char) || /\p{Number}/u.test(char)) {
        return char
      }

      return "-"
    })
    .join("")
}
