import Principal "mo:base/Principal";
import HashMap "mo:base/HashMap";
import Types "./Types";
import Buffer "mo:base/Buffer";
import Text "mo:base/Text";
import Hash "mo:base/Hash";
import Nat "mo:base/Nat";
import Iter "mo:base/Iter";
import BufferUtils "./BufferUtils";
import Float "mo:base/Float";
import Int "mo:base/Int";

module {
  public type StableState = {
    var nextRoomId: Types.RoomId;
    var nextMessageId: Types.MessageId;
    var nextItemTypeId: Types.ItemTypeId;
    var nextItemId: Types.ItemId;
    var stableRooms: [(Types.RoomId, Types.Room)];
    var stablePlayers: [(Principal, Text)];
    var stableUsedNames: [(Text, Principal)];
    var stablePlayerLocations: [(Principal, Types.RoomId)];
    var stableRealmConfig: Types.RealmConfig;
    var stableMessageLogs: [(Principal, Types.StableCircularBuffer)];
    var stableItemTypes: [(Types.ItemTypeId, Types.ItemType)];
    var stableItems: [(Types.ItemId, Types.Item)];
    var stablePlayerBaseStats: [(Principal, Types.BaseStats)];
    var stablePlayerDynamicStats: [(Principal, Types.DynamicStats)];
  };

  public type MudState = {
    rooms: HashMap.HashMap<Types.RoomId, Types.Room>;
    players: HashMap.HashMap<Principal, Text>;
    usedNames: HashMap.HashMap<Text, Principal>;
    playerLocations: HashMap.HashMap<Principal, Types.RoomId>;
    messageLogs: HashMap.HashMap<Principal, Types.CircularBuffer>;
    itemTypes: HashMap.HashMap<Types.ItemTypeId, Types.ItemType>;
    items: HashMap.HashMap<Types.ItemId, Types.Item>;
    stable_state: StableState;
    var realmConfig: Types.RealmConfig;
    playerBaseStats: HashMap.HashMap<Principal, Types.BaseStats>;
    playerDynamicStats: HashMap.HashMap<Principal, Types.DynamicStats>;
  };

  public func initStable() : StableState {
    let state : StableState = {
      var nextRoomId = 0;
      var nextMessageId = 0;
      var nextItemTypeId = 0;
      var nextItemId = 0;
      var stableRooms = [] : [(Types.RoomId, Types.Room)];
      var stablePlayers = [] : [(Principal, Text)];
      var stableUsedNames = [] : [(Text, Principal)];
      var stablePlayerLocations = [] : [(Principal, Types.RoomId)];
      var stableRealmConfig = {
        name = "Default Realm";
        description = "A new realm awaiting configuration";
        owners = [Principal.fromText("2vxsx-fae")];
      };
      var stableMessageLogs = [] : [(Principal, Types.StableCircularBuffer)];
      var stableItemTypes = [] : [(Types.ItemTypeId, Types.ItemType)];
      var stableItems = [] : [(Types.ItemId, Types.Item)];
      var stablePlayerBaseStats = [] : [(Principal, Types.BaseStats)];
      var stablePlayerDynamicStats = [] : [(Principal, Types.DynamicStats)];
    };
    state
  };

  public func init(stable_state: StableState) : MudState {
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

    let messageLogs = HashMap.HashMap<Principal, Types.CircularBuffer>(10, Principal.equal, Principal.hash);
    for ((principal, stableBuffer) in stable_state.stableMessageLogs.vals()) {
      messageLogs.put(principal, BufferUtils.createCircularBufferFromStable(stableBuffer));
    };

    let itemTypes = HashMap.fromIter<Types.ItemTypeId, Types.ItemType>(
      stable_state.stableItemTypes.vals(),
      10,
      Nat.equal,
      Hash.hash
    );

    let items = HashMap.fromIter<Types.ItemId, Types.Item>(
      stable_state.stableItems.vals(),
      10,
      Nat.equal,
      Hash.hash
    );

    let playerBaseStats = HashMap.fromIter<Principal, Types.BaseStats>(
      stable_state.stablePlayerBaseStats.vals(),
      0,
      Principal.equal,
      Principal.hash
    );

    let playerDynamicStats = HashMap.fromIter<Principal, Types.DynamicStats>(
      stable_state.stablePlayerDynamicStats.vals(),
      0,
      Principal.equal,
      Principal.hash
    );

    {
      rooms = rooms;
      players = players;
      usedNames = usedNames;
      playerLocations = playerLocations;
      messageLogs = messageLogs;
      itemTypes = itemTypes;
      items = items;
      stable_state = stable_state;
      var realmConfig = stable_state.stableRealmConfig;
      playerBaseStats = playerBaseStats;
      playerDynamicStats = playerDynamicStats;
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

    let stableState : StableState = {
      var nextRoomId = state.stable_state.nextRoomId;
      var nextMessageId = state.stable_state.nextMessageId;
      var nextItemTypeId = state.stable_state.nextItemTypeId;
      var nextItemId = state.stable_state.nextItemId;
      var stableRooms = Iter.toArray(state.rooms.entries());
      var stablePlayers = Iter.toArray(state.players.entries());
      var stableUsedNames = Iter.toArray(state.usedNames.entries());
      var stablePlayerLocations = Iter.toArray(state.playerLocations.entries());
      var stableRealmConfig = state.realmConfig;
      var stableMessageLogs = Buffer.toArray(stableMessageLogs);
      var stableItemTypes = Iter.toArray(state.itemTypes.entries());
      var stableItems = Iter.toArray(state.items.entries());
      var stablePlayerBaseStats = Iter.toArray(state.playerBaseStats.entries());
      var stablePlayerDynamicStats = Iter.toArray(state.playerDynamicStats.entries());
    };
    stableState
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

  // Helper function to calculate XP needed for next level
  public func xpForNextLevel(currentLevel: Nat) : Nat {
    // Special case for level 1->2
    if (currentLevel == 1) {
      return 2000;
    };
    
    // Original formula: 55.6 * (level ^ 2) - (471.2 * level) + 5256.5
    // Multiplied by 10 to maintain precision with integer math
    let level_squared = currentLevel * currentLevel;
    let xp_int = (556 * level_squared) / 10 - (4712 * currentLevel) / 10 + 52565 / 10;
    Int.abs(xp_int)
  };
} 