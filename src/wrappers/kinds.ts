/**
 * Nostr Event Kinds
 *
 * Constants for all standardized Nostr event kinds.
 * Based on https://github.com/nostr-protocol/nips
 *
 * @example
 * ```typescript
 * import { kinds } from 'nostr-effect/kinds'
 *
 * // Create a text note
 * const event = { kind: kinds.ShortTextNote, ... }
 *
 * // Check if event is a reaction
 * if (event.kind === kinds.Reaction) { ... }
 * ```
 */

// =============================================================================
// Core Event Kinds (NIP-01)
// =============================================================================

/** User metadata (NIP-01) */
export const Metadata = 0

/** Short text note (NIP-01) */
export const ShortTextNote = 1

/** Relay list metadata (NIP-65) - DEPRECATED, use kind 10002 */
export const RecommendRelay = 2

/** Follow list (NIP-02) */
export const Contacts = 3

/** Encrypted direct message (NIP-04) - DEPRECATED */
export const EncryptedDirectMessage = 4

/** Event deletion request (NIP-09) */
export const EventDeletion = 5

/** Repost (NIP-18) */
export const Repost = 6

/** Reaction (NIP-25) */
export const Reaction = 7

/** Badge award (NIP-58) */
export const BadgeAward = 8

/** Seal (NIP-59) */
export const Seal = 13

/** Private direct message (NIP-17) */
export const PrivateDirectMessage = 14

/** Generic repost (NIP-18) */
export const GenericRepost = 16

// =============================================================================
// Channel Events (NIP-28)
// =============================================================================

/** Channel creation (NIP-28) */
export const ChannelCreation = 40

/** Channel metadata (NIP-28) */
export const ChannelMetadata = 41

/** Channel message (NIP-28) */
export const ChannelMessage = 42

/** Channel hide message (NIP-28) */
export const ChannelHideMessage = 43

/** Channel mute user (NIP-28) */
export const ChannelMuteUser = 44

// =============================================================================
// Regular Events (NIP-16 replaceable)
// =============================================================================

/** Open timestamps (NIP-03) */
export const OpenTimestamps = 1040

/** File metadata (NIP-94) */
export const FileMetadata = 1063

/** Live chat message */
export const LiveChatMessage = 1311

/** Problem tracker */
export const ProblemTracker = 1971

/** Report (NIP-56) */
export const Report = 1984

/** Reporting (NIP-56) - alias for Report */
export const Reporting = 1984

/** Label (NIP-32) */
export const Label = 1985

/** Community post approval (NIP-72) */
export const CommunityPostApproval = 4550

/** DVM job request (NIP-90) */
export const JobRequest = 5999

/** DVM job result (NIP-90) */
export const JobResult = 6999

/** DVM job feedback (NIP-90) */
export const JobFeedback = 7000

/** Zap goal (NIP-75) */
export const ZapGoal = 9041

/** Highlights (NIP-84) */
export const Highlights = 9802

// =============================================================================
// Replaceable Events (10000-19999)
// =============================================================================

/** Mute list (NIP-51) */
export const MuteList = 10000

/** Mute list (NIP-51) - lowercase alias */
export const Mutelist = 10000

/** Pin list (NIP-51) */
export const PinList = 10001

/** Pin list (NIP-51) - lowercase alias */
export const Pinlist = 10001

/** Relay list metadata (NIP-65) */
export const RelayList = 10002

/** Bookmarks list (NIP-51) */
export const BookmarkList = 10003

/** Communities list (NIP-51) */
export const CommunitiesList = 10004

/** Public chats list (NIP-51) */
export const PublicChatsList = 10005

/** Blocked relays list (NIP-51) */
export const BlockedRelaysList = 10006

/** Search relays list (NIP-51) */
export const SearchRelaysList = 10007

/** Simple groups list (NIP-51) */
export const SimpleGroupsList = 10009

/** Interests list (NIP-51) */
export const InterestsList = 10015

/** Emojis list (NIP-51) */
export const EmojisList = 10030

/** User emoji list (NIP-51) - alias */
export const UserEmojiList = 10030

/** Direct message relays list (NIP-17) */
export const DirectMessageRelaysList = 10050

/** File server preference */
export const FileServerPreference = 10096

/** Good wiki authors (NIP-54) */
export const GoodWikiAuthors = 10101

/** Good wiki relays (NIP-54) */
export const GoodWikiRelays = 10102

/** NWC wallet info (NIP-47) */
export const NWCWalletInfo = 13194

// =============================================================================
// Ephemeral Events (20000-29999)
// =============================================================================

/** Lightning pub RPC */
export const LightningPubRPC = 21000

/** Authentication (NIP-42) */
export const ClientAuth = 22242

/** NWC wallet request (NIP-47) */
export const NWCWalletRequest = 23194

/** NWC wallet response (NIP-47) */
export const NWCWalletResponse = 23195

/** Nostr Connect (NIP-46) */
export const NostrConnect = 24133

// =============================================================================
// Lettered NIPs
// =============================================================================

/** NIP-C0 Code Snippet */
export const CodeSnippet = 1337

/** NIP-C7 Chat Message */
export const ChatMessageC7 = 9

/** Nostr Connect request (NIP-46) - alias */
export const NostrConnectRequest = 24133

/** HTTP auth (NIP-98) */
export const HTTPAuth = 27235

// =============================================================================
// Parameterized Replaceable Events (30000-39999)
// =============================================================================

/** Follow sets (NIP-51) */
export const FollowSets = 30000

/** Follow sets (NIP-51) - lowercase alias */
export const Followsets = 30000

/** Generic lists (NIP-51) */
export const GenericLists = 30001

/** Generic lists (NIP-51) - lowercase alias */
export const Genericlists = 30001

/** Relay sets (NIP-51) */
export const RelaySets = 30002

/** Relay sets (NIP-51) - lowercase alias */
export const Relaysets = 30002

/** Bookmark sets (NIP-51) */
export const BookmarkSets = 30003

/** Bookmark sets (NIP-51) - lowercase alias */
export const Bookmarksets = 30003

/** Curation sets (NIP-51) */
export const CurationSets = 30004

/** Curation sets (NIP-51) - lowercase alias */
export const Curationsets = 30004

/** Video sets (NIP-51) */
export const VideoSets = 30005

/** Profile badges (NIP-58) */
export const ProfileBadges = 30008

/** Badge definition (NIP-58) */
export const BadgeDefinition = 30009

/** Interest sets (NIP-51) */
export const InterestSets = 30015

/** Interest sets (NIP-51) - lowercase alias */
export const Interestsets = 30015

/** Create or update stall (NIP-15) */
export const CreateOrUpdateStall = 30017

/** Create or update product (NIP-15) */
export const CreateOrUpdateProduct = 30018

/** Long-form content (NIP-23) */
export const LongFormArticle = 30023

/** Draft long-form content (NIP-23) */
export const LongFormArticleDraft = 30024

/** Draft long-form (NIP-23) - alias */
export const DraftLong = 30024

/** Emoji sets (NIP-51) */
export const EmojiSets = 30030

/** Emoji sets (NIP-51) - lowercase alias */
export const Emojisets = 30030

/** Application-specific data (NIP-78) */
export const ApplicationSpecificData = 30078

/** Application (NIP-78) - alias */
export const Application = 30078

// =============================================================================
// Ecash Mint Discoverability (NIP-87)
// =============================================================================

/** Mint recommendation (NIP-87) */
export const MintRecommendation = 38000

/** Cashu mint information (NIP-87) */
export const CashuMintInformation = 38172

/** Fedimint information (NIP-87) */
export const FedimintInformation = 38173

/** Live event (NIP-53) */
export const LiveEvent = 30311

/** User statuses (NIP-38) */
export const UserStatuses = 30315

/** Classified listing (NIP-99) */
export const ClassifiedListing = 30402

/** Draft classified listing (NIP-99) */
export const ClassifiedListingDraft = 30403

/** Draft classified listing (NIP-99) - alias */
export const DraftClassifiedListing = 30403

/** Date-based calendar event (NIP-52) */
export const DateBasedCalendarEvent = 31922

/** Date (NIP-52) - alias */
export const Date = 31922

/** Time-based calendar event (NIP-52) */
export const TimeBasedCalendarEvent = 31923

/** Time (NIP-52) - alias */
export const Time = 31923

/** Calendar (NIP-52) */
export const Calendar = 31924

/** Calendar RSVP (NIP-52) */
export const CalendarRSVP = 31925

/** Calendar event RSVP (NIP-52) - alias */
export const CalendarEventRSVP = 31925

/** Handler recommendation (NIP-89) */
export const HandlerRecommendation = 31989

/** Handler information (NIP-89) */
export const HandlerInformation = 31990

/** Handler recommendation (NIP-89) - lowercase alias */
export const Handlerrecommendation = 31989

/** Handler information (NIP-89) - lowercase alias */
export const Handlerinformation = 31990

/** Community definition (NIP-72) */
export const CommunityDefinition = 34550

/** Wiki article (NIP-54) */
export const WikiArticle = 30818

/** Redirect (NIP-54) */
export const Redirect = 30819

// =============================================================================
// Relay Discovery & Liveness (NIP-66)
// =============================================================================

/** Relay discovery info (NIP-66) */
export const RelayDiscoveryInfo = 30166

/** Relay monitor announcement (NIP-66) */
export const RelayMonitorAnnouncement = 10166

// =============================================================================
// DVM Events (NIP-90)
// =============================================================================

/** DVM job request base (5000-5999) */
export const DVMRequestTextExtraction = 5000
export const DVMRequestSummarization = 5001
export const DVMRequestTranslation = 5002
export const DVMRequestTextGeneration = 5050
export const DVMRequestImageGeneration = 5100
export const DVMRequestTextToSpeech = 5250
export const DVMRequestDiscoveryContent = 5300
export const DVMRequestDiscoveryPeople = 5301
export const DVMRequestTimestamping = 5900

/** DVM job result base (6000-6999) - request kind + 1000 */
export const DVMResultTextExtraction = 6000
export const DVMResultSummarization = 6001
export const DVMResultTranslation = 6002
export const DVMResultTextGeneration = 6050
export const DVMResultImageGeneration = 6100
export const DVMResultTextToSpeech = 6250
export const DVMResultDiscoveryContent = 6300
export const DVMResultDiscoveryPeople = 6301
export const DVMResultTimestamping = 6900

/** DVM job feedback (7000) */
export const DVMJobFeedback = 7000

// =============================================================================
// Zap Events (NIP-57)
// =============================================================================

/** Zap request (NIP-57) */
export const ZapRequest = 9734

/** Zap receipt (NIP-57) */
export const ZapReceipt = 9735

/** Zap (NIP-57) - alias for ZapReceipt */
export const Zap = 9735

// =============================================================================
// Gift Wrap Events (NIP-59)
// =============================================================================

/** Gift wrap (NIP-59) */
export const GiftWrap = 1059

// =============================================================================
// Wallet Connect Events (NIP-47)
// =============================================================================

/** Wallet Connect request (NIP-47) */
export const WalletConnectRequest = 23194

/** Wallet Connect response (NIP-47) */
export const WalletConnectResponse = 23195

/** Wallet Connect info (NIP-47) */
export const WalletConnectInfo = 13194

// =============================================================================
// Git Events (NIP-34)
// =============================================================================

/** Git repository announcement (NIP-34) */
export const GitRepoAnnouncement = 30617

/** Git state announcement (NIP-34) */
export const GitStateAnnouncement = 30618

/** Git patch (NIP-34) */
export const GitPatch = 1617

/** Git issue (NIP-34) */
export const GitIssue = 1621

/** Git reply (NIP-34) */
export const GitReply = 1622

/** Git status open */
export const GitStatusOpen = 1630

/** Git status applied/merged */
export const GitStatusApplied = 1631

/** Git status closed */
export const GitStatusClosed = 1632

/** Git status draft */
export const GitStatusDraft = 1633

// =============================================================================
// Helper Functions
// =============================================================================

/** Event type for isKind validation */
interface NostrEvent {
  kind: number
  id?: string
  pubkey?: string
  created_at?: number
  content?: string
  tags?: string[][]
  sig?: string
}

/**
 * Check if a kind is regular (stored permanently, not replaceable)
 * Events are regular, which means they're all expected to be stored by relays.
 */
export function isRegularKind(kind: number): boolean {
  return kind < 10000 && kind !== 0 && kind !== 3
}

/** Alias for nostr-effect compatibility */
export const isRegular = isRegularKind

/**
 * Check if a kind is replaceable (NIP-16)
 * Events are replaceable, which means that, for each combination of pubkey and kind,
 * only the latest event is expected to be stored by relays.
 */
export function isReplaceableKind(kind: number): boolean {
  return kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000)
}

/** Alias for nostr-effect compatibility */
export const isReplaceable = isReplaceableKind

/**
 * Check if a kind is ephemeral (NIP-16)
 * Events are ephemeral, which means they are not expected to be stored by relays.
 */
export function isEphemeralKind(kind: number): boolean {
  return kind >= 20000 && kind < 30000
}

/** Alias for nostr-effect compatibility */
export const isEphemeral = isEphemeralKind

/**
 * Check if a kind is addressable/parameterized replaceable (NIP-33)
 * Events are addressable, which means that, for each combination of pubkey, kind
 * and the d tag, only the latest event is expected to be stored by relays.
 */
export function isAddressableKind(kind: number): boolean {
  return kind >= 30000 && kind < 40000
}

/** Alias for nostr-effect compatibility */
export const isParameterizedReplaceable = isAddressableKind

/** Classification of the event kind */
export type KindClassification = "regular" | "replaceable" | "ephemeral" | "parameterized" | "unknown"

/**
 * Determine the classification of this kind of event if known, or unknown.
 */
export function classifyKind(kind: number): KindClassification {
  if (isRegularKind(kind)) return "regular"
  if (isReplaceableKind(kind)) return "replaceable"
  if (isEphemeralKind(kind)) return "ephemeral"
  if (isAddressableKind(kind)) return "parameterized"
  return "unknown"
}

/**
 * Type guard to check if an event has a specific kind
 */
export function isKind<T extends number>(
  event: unknown,
  kind: T | T[]
): event is NostrEvent & { kind: T } {
  const kindArray: number[] = Array.isArray(kind) ? kind : [kind]
  if (typeof event !== "object" || event === null) return false
  const e = event as Record<string, unknown>
  return typeof e.kind === "number" && kindArray.includes(e.kind)
}

/**
 * Get the result kind for a DVM request kind
 */
export function getDVMResultKind(requestKind: number): number {
  if (requestKind >= 5000 && requestKind < 6000) {
    return requestKind + 1000
  }
  throw new Error(`Invalid DVM request kind: ${requestKind}`)
}

// =============================================================================
// Default Export
// =============================================================================

export const kinds = {
  Metadata,
  ShortTextNote,
  RecommendRelay,
  Contacts,
  EncryptedDirectMessage,
  EventDeletion,
  Repost,
  Reaction,
  BadgeAward,
  GenericRepost,
  ChannelCreation,
  ChannelMetadata,
  ChannelMessage,
  ChannelHideMessage,
  ChannelMuteUser,
  FileMetadata,
  LiveChatMessage,
  ProblemTracker,
  Reporting,
  Label,
  MuteList,
  PinList,
  RelayList,
  BookmarkList,
  CommunitiesList,
  PublicChatsList,
  BlockedRelaysList,
  SearchRelaysList,
  SimpleGroupsList,
  InterestsList,
  EmojisList,
  GoodWikiAuthors,
  GoodWikiRelays,
  ClientAuth,
  NostrConnectRequest,
  FollowSets,
  GenericLists,
  RelaySets,
  BookmarkSets,
  CurationSets,
  VideoSets,
  ProfileBadges,
  BadgeDefinition,
  InterestSets,
  EmojiSets,
  LongFormArticle,
  LongFormArticleDraft,
  ApplicationSpecificData,
  LiveEvent,
  UserStatuses,
  ClassifiedListing,
  ClassifiedListingDraft,
  DateBasedCalendarEvent,
  TimeBasedCalendarEvent,
  Calendar,
  CalendarRSVP,
  HandlerRecommendation,
  HandlerInformation,
  WikiArticle,
  Redirect,
  DVMRequestTextExtraction,
  DVMRequestSummarization,
  DVMRequestTranslation,
  DVMRequestTextGeneration,
  DVMRequestImageGeneration,
  DVMRequestTextToSpeech,
  DVMRequestDiscoveryContent,
  DVMRequestDiscoveryPeople,
  DVMRequestTimestamping,
  DVMResultTextExtraction,
  DVMResultSummarization,
  DVMResultTranslation,
  DVMResultTextGeneration,
  DVMResultImageGeneration,
  DVMResultTextToSpeech,
  DVMResultDiscoveryContent,
  DVMResultDiscoveryPeople,
  DVMResultTimestamping,
  DVMJobFeedback,
  ZapRequest,
  ZapReceipt,
  Seal,
  GiftWrap,
  WalletConnectRequest,
  WalletConnectResponse,
  WalletConnectInfo,
  GitRepoAnnouncement,
  GitStateAnnouncement,
  GitPatch,
  GitIssue,
  GitReply,
  GitStatusOpen,
  GitStatusApplied,
  GitStatusClosed,
  GitStatusDraft,
  isReplaceable,
  isEphemeral,
  isParameterizedReplaceable,
  isRegular,
  getDVMResultKind,
}

export default kinds
