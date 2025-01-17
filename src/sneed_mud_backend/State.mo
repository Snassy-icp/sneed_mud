import Principal "mo:base/Principal";
import HashMap "mo:base/HashMap";
import Types "./Types";
import Buffer "mo:base/Buffer";
import Text "mo:base/Text";
import Hash "mo:base/Hash";
import Nat "mo:base/Nat";
import Iter "mo:base/Iter";

module {
  public type StableState = {
    var nextRoomId: Types.RoomId;
    var nextMessageId: Types.MessageId;
    var stableRooms: [(Types.RoomId, Types.Room)];
    var stablePlayers: [(Principal, Text)];
    var stableUsedNames: [(Text, Principal)];
    var stablePlayerLocations: [(Principal, Types.RoomId)];
    var stableRealmConfig: Types.RealmConfig;
    var stableMessageLogs: [(Principal, Types.StableCircularBuffer)];
  };

  public type MudState = {
    rooms: HashMap.HashMap<Types.RoomId, Types.Room>;
    players: HashMap.HashMap<Principal, Text>;
    usedNames: HashMap.HashMap<Text, Principal>;
    playerLocations: HashMap.HashMap<Principal, Types.RoomId>;
    messageLogs: HashMap.HashMap<Principal, Types.CircularBuffer>;
    stable_state: StableState;
    var realmConfig: Types.RealmConfig;
  };

  public func initStable() : StableState {
    {
      var nextRoomId = 0;
      var nextMessageId = 0;
      var stableRooms = [];
      var stablePlayers = [];
      var stableUsedNames = [];
      var stablePlayerLocations = [];
      var stableRealmConfig = {
        name = "Default Realm";
        description = "A new realm awaiting configuration";
        owners = [Principal.fromText("2vxsx-fae")];
      };
      var stableMessageLogs = [];
    }
  };

  public func init(stable_state: StableState) : MudState {
    // Initialize hashmaps with stable data
    let rooms = HashMap.fromIter<Types.RoomId, Types.Room>(
      stable_state.stableRooms.vals(),
      10,
      Nat.equal,
      Hash.hash
    );
    let players = HashMap.fromIter<Principal, Text>(
      stable_state.stablePlayers.vals(),
      10,
      Principal.equal,
      Principal.hash
    );
    let usedNames = HashMap.fromIter<Text, Principal>(
      stable_state.stableUsedNames.vals(),
      10,
      Text.equal,
      Text.hash
    );
    let playerLocations = HashMap.fromIter<Principal, Types.RoomId>(
      stable_state.stablePlayerLocations.vals(),
      10,
      Principal.equal,
      Principal.hash
    );
    
    // Convert stable message logs to runtime circular buffers
    let messageLogs = HashMap.HashMap<Principal, Types.CircularBuffer>(10, Principal.equal, Principal.hash);
    for ((principal, stableLog) in stable_state.stableMessageLogs.vals()) {
      let runtimeBuffer = Buffer.Buffer<Types.LogMessage>(stableLog.capacity);
      for (msg in stableLog.messages.vals()) {
        runtimeBuffer.add(msg);
      };
      let circularBuffer : Types.CircularBuffer = {
        var buffer = runtimeBuffer;
        var start = stableLog.start;
        var size = stableLog.size;
        var capacity = stableLog.capacity;
        var highestId = stableLog.highestId;
      };
      messageLogs.put(principal, circularBuffer);
    };

    {
      rooms = rooms;
      players = players;
      usedNames = usedNames;
      playerLocations = playerLocations;
      messageLogs = messageLogs;
      stable_state = stable_state;
      var realmConfig = stable_state.stableRealmConfig;
    }
  };

  public func preupgrade(state: MudState) : StableState {
    // Convert runtime circular buffers to stable format
    let stableMessageLogs = Buffer.Buffer<(Principal, Types.StableCircularBuffer)>(0);
    for ((principal, circularBuffer) in state.messageLogs.entries()) {
      let messages = Buffer.toArray(circularBuffer.buffer);
      let stableBuffer : Types.StableCircularBuffer = {
        messages = messages;
        start = circularBuffer.start;
        size = circularBuffer.size;
        capacity = circularBuffer.capacity;
        highestId = circularBuffer.highestId;
      };
      stableMessageLogs.add((principal, stableBuffer));
    };

    {
      var nextRoomId = state.stable_state.nextRoomId;
      var nextMessageId = state.stable_state.nextMessageId;
      var stableRooms = Iter.toArray(state.rooms.entries());
      var stablePlayers = Iter.toArray(state.players.entries());
      var stableUsedNames = Iter.toArray(state.usedNames.entries());
      var stablePlayerLocations = Iter.toArray(state.playerLocations.entries());
      var stableRealmConfig = state.realmConfig;
      var stableMessageLogs = Buffer.toArray(stableMessageLogs);
    }
  };

  // Helper functions for ownership checks
  public func isRealmOwner(state: MudState, principal: Principal) : Bool {
    for (owner in state.realmConfig.owners.vals()) {
      if (Principal.equal(owner, principal)) {
        return true;
      };
    };
    false
  };

  public func isRoomOwner(room: Types.Room, principal: Principal) : Bool {
    for (owner in room.owners.vals()) {
      if (Principal.equal(owner, principal)) {
        return true;
      };
    };
    false
  };

  public func hasRoomAccess(state: MudState, room: Types.Room, principal: Principal) : Bool {
    isRealmOwner(state, principal) or isRoomOwner(room, principal)
  };

  // Helper function to convert array to buffer
  public func arrayToBuffer<T>(array: [T]) : Buffer.Buffer<T> {
    let buffer = Buffer.Buffer<T>(array.size());
    for (item in array.vals()) {
      buffer.add(item);
    };
    buffer
  };

  // Helper function to convert buffer to array
  public func bufferToArray<T>(buffer: Buffer.Buffer<T>) : [T] {
    Buffer.toArray(buffer)
  };
} 