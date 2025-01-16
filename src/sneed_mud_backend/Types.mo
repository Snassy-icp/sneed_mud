module {
  public type RoomId = Nat;
  
  public type Exit = {
    name: Text;  // e.g. "wooden door", "narrow passage"
    description: Text;  // More detailed description of the exit
    targetRoomId: RoomId;
    direction: ?Text;  // Optional hint like "north", "up", etc.
  };

  public type Room = {
    id: RoomId;
    name: Text;
    description: Text;
    exits: [(Text, Exit)];  // Key is a unique identifier for the exit in this room
  };

  public type MessageId = Nat;

  public type LogMessage = {
    id: MessageId;
    timestamp: Int;  // Nanoseconds since 1970-01-01
    content: Text;
  };

  public type CircularBuffer<T> = {
    var buffer: [var ?T];
    var start: Nat;  // Index of oldest element
    var size: Nat;   // Current number of elements
    var highestId: ?MessageId;  // Highest message ID in the buffer
  };
} 