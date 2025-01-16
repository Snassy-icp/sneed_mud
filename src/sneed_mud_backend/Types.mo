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
} 