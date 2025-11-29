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

/** File metadata (NIP-94) */
export const FileMetadata = 1063

/** Live chat message */
export const LiveChatMessage = 1311

/** Problem tracker */
export const ProblemTracker = 1971

/** Reporting (NIP-56) */
export const Reporting = 1984

/** Label (NIP-32) */
export const Label = 1985

// =============================================================================
// Replaceable Events (10000-19999)
// =============================================================================

/** Mute list (NIP-51) */
export const MuteList = 10000

/** Pin list (NIP-51) */
export const PinList = 10001

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

/** Good wiki authors (NIP-54) */
export const GoodWikiAuthors = 10101

/** Good wiki relays (NIP-54) */
export const GoodWikiRelays = 10102

// =============================================================================
// Ephemeral Events (20000-29999)
// =============================================================================

/** Authentication (NIP-42) */
export const ClientAuth = 22242

/** Nostr Connect request (NIP-46) */
export const NostrConnectRequest = 24133

// =============================================================================
// Parameterized Replaceable Events (30000-39999)
// =============================================================================

/** Follow sets (NIP-51) */
export const FollowSets = 30000

/** Generic lists (NIP-51) */
export const GenericLists = 30001

/** Relay sets (NIP-51) */
export const RelaySets = 30002

/** Bookmark sets (NIP-51) */
export const BookmarkSets = 30003

/** Curation sets (NIP-51) */
export const CurationSets = 30004

/** Video sets (NIP-51) */
export const VideoSets = 30005

/** Profile badges (NIP-58) */
export const ProfileBadges = 30008

/** Badge definition (NIP-58) */
export const BadgeDefinition = 30009

/** Interest sets (NIP-51) */
export const InterestSets = 30015

/** Emoji sets (NIP-51) */
export const EmojiSets = 30030

/** Long-form content (NIP-23) */
export const LongFormArticle = 30023

/** Draft long-form content (NIP-23) */
export const LongFormArticleDraft = 30024

/** Application-specific data (NIP-78) */
export const ApplicationSpecificData = 30078

/** Live event (NIP-53) */
export const LiveEvent = 30311

/** User statuses (NIP-38) */
export const UserStatuses = 30315

/** Classified listing (NIP-99) */
export const ClassifiedListing = 30402

/** Draft classified listing (NIP-99) */
export const ClassifiedListingDraft = 30403

/** Date-based calendar event (NIP-52) */
export const DateBasedCalendarEvent = 31922

/** Time-based calendar event (NIP-52) */
export const TimeBasedCalendarEvent = 31923

/** Calendar (NIP-52) */
export const Calendar = 31924

/** Calendar RSVP (NIP-52) */
export const CalendarRSVP = 31925

/** Handler recommendation (NIP-89) */
export const HandlerRecommendation = 31989

/** Handler information (NIP-89) */
export const HandlerInformation = 31990

/** Wiki article (NIP-54) */
export const WikiArticle = 30818

/** Redirect (NIP-54) */
export const Redirect = 30819

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

// =============================================================================
// Gift Wrap Events (NIP-59)
// =============================================================================

/** Seal (NIP-59) */
export const Seal = 13

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

/**
 * Check if a kind is replaceable (NIP-16)
 */
export function isReplaceable(kind: number): boolean {
  return kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000)
}

/**
 * Check if a kind is ephemeral (NIP-16)
 */
export function isEphemeral(kind: number): boolean {
  return kind >= 20000 && kind < 30000
}

/**
 * Check if a kind is parameterized replaceable (NIP-33)
 */
export function isParameterizedReplaceable(kind: number): boolean {
  return kind >= 30000 && kind < 40000
}

/**
 * Check if a kind is regular (stored permanently, not replaceable)
 */
export function isRegular(kind: number): boolean {
  return (kind >= 1000 && kind < 10000) || (kind >= 4 && kind < 45) || kind === 1 || kind === 2
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
