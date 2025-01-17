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
    subaccount: ?Subaccount;
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
    var highestId: ?MessageId;
  };

  // Stable version of circular buffer for upgrades
  public type StableCircularBuffer = {
    messages: [LogMessage];
    start: Nat;
    size: Nat;
    capacity: Nat;
    highestId: ?MessageId;
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
} 