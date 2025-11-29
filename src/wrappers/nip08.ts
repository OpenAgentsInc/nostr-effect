/**
 * NIP-08: Handling Mentions (deprecated in favor of NIP-27, but still supported as helpers)
 * Spec: ~/code/nips/08.md
 */

export type Mention =
  | { type: "p"; value: string }
  | { type: "e"; value: string }

/** Result of building content + tags with mentions */
export interface MentionBuildResult {
  readonly content: string
  readonly tags: string[][]
}

/**
 * Build content that includes `#[index]` placeholders per NIP-08 and returns the augmented tags array.
 *
 * Example:
 *   buildMentionedContent(["Hello ", { type: "p", value: pubkey }, "!"], [])
 *   => content: "Hello #[0]!", tags: [["p", pubkey]]
 */
export function buildMentionedContent(
  parts: readonly (string | Mention)[],
  baseTags: readonly string[][] = []
): MentionBuildResult {
  const tags: string[][] = baseTags.map((t) => t.slice())
  let content = ""

  for (const part of parts) {
    if (typeof part === "string") {
      content += part
      continue
    }
    const idx = tags.length
    if (part.type === "p") tags.push(["p", part.value])
    else tags.push(["e", part.value])
    content += `#[${idx}]`
  }

  return { content, tags }
}

