import Principal "mo:base/Principal";
import Buffer "mo:base/Buffer";
import Blob "mo:base/Blob";

module {
  public type RoomId = Nat;
  public type MessageId = Nat;
  public type ItemId = Nat;
  public type ItemTypeId = Nat;
  public type Subaccount = Blob;

  public type Account = {
    owner: Principal;
    subaccount: ?Blob;
  };

  public type Exit = {
    name: Text;
    description: Text;
    targetRoomId: RoomId;
    direction: ?Text;
  };

  public type Room = {
    id: RoomId;
    name: Text;
    description: Text;
    exits: [(Text, Exit)];
    owners: [Principal];  // List of principals that own this room
  };

  public type LogMessage = {
    id: MessageId;
    timestamp: Int;
    content: Text;
  };

  // Mutable circular buffer for runtime use
  public type CircularBuffer = {
    var buffer: Buffer.Buffer<LogMessage>;
    var start: Nat;
    var size: Nat;
    var capacity: Nat;
    var highestId: MessageId;
  };

  // Stable version of circular buffer for upgrades
  public type StableCircularBuffer = {
    messages: [LogMessage];
    start: Nat;
    size: Nat;
    capacity: Nat;
    highestId: MessageId;
  };

  // Realm configuration as an immutable record
  public type RealmConfig = {
    name: Text;
    description: Text;
    owners: [Principal];
  };

  // Item system types
  public type ItemType = {
    id: ItemTypeId;
    name: Text;
    description: Text;
    is_container: Bool;
    container_capacity: ?Nat;  // Only present if is_container is true
    icon_url: Text;
    stack_max: Nat;  // Maximum number of items that can stack in one slot
  };

  public type Item = {
    id: ItemId;
    type_id: ItemTypeId;
    is_open: Bool;  // Only relevant if item type is a container
    owner: Account;
    count: Nat;     // Number of items in this stack, must not exceed type's stack_max
  };

  // Item event types for logging
  public type ItemEventKind = {
    #Mint;     // Item created
    #Transfer; // Item changed ownership
    #Burn;     // Item destroyed
  };

  public type ItemEvent = {
    id: MessageId;  // Using the same message ID system as chat
    timestamp: Int;
    kind: ItemEventKind;
    item_id: ItemId;
    from: ?Account;  // None for Mint
    to: ?Account;    // None for Burn
  };

  public type ItemInfo = {
    id : ItemId;
    item_type : ItemType; // NB: "type" is a reserved word and can not be used for the field name.
    count : Nat;
    is_open : Bool;
  };

  // Stats that change frequently (HP, MP, XP)
  public type DynamicStats = {
    hp: Nat;
    mp: Nat;
    xp: Nat;
  };

  // Stats that change rarely (level, max values)
  public type BaseStats = {
    level: Nat;
    maxHp: Nat;
    maxMp: Nat;
  };

  // Combined player stats for queries
  public type PlayerStats = {
    base: BaseStats;
    dynamic: DynamicStats;
  };

  // Token metadata types
  public type TokenMetadata = {
    name: Text;
    symbol: Text;
    decimals: Nat;
    fee: Nat;
    lastRefreshed: Int;
  };

  public type TokenInfo = {
    ledgerCanisterId: Principal;
    metadata: ?TokenMetadata;  // None if stale or not in cache
  };

  // AFK system types
  public type AfkConfig = {
    afk_timeout_ns: Int;     // Time in nanoseconds before a player is considered AFK (default 20 minutes)
    offline_timeout_ns: Int;  // Time in nanoseconds before a player is considered offline (default 1 hour)
  };

  // Combat system types
  public type CombatState = {
    inCombat: Bool;
    combatEndTime: Int;    // Time when combat state expires
    lastAttackTime: Int;   // For cooldown tracking
  };

  public type AttackResult = {
    damage: Nat;
    attackerNewHp: Nat;
    targetNewHp: Nat;
    counterDamage: ?Nat;   // Only present for NPC counter-attacks
  };

  // Stable state for token registrations
  public type StableTokenRegistrations = [(Principal, [Principal])];  // user -> [ledger canister IDs]
} 