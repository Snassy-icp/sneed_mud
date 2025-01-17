import Principal "mo:base/Principal";
import Buffer "mo:base/Buffer";

module {
  public type RoomId = Nat;
  public type MessageId = Nat;

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
} 