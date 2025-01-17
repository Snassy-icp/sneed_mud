import Principal "mo:base/Principal";
import HashMap "mo:base/HashMap";
import Types "./Types";
import Buffer "mo:base/Buffer";
import Text "mo:base/Text";
import Hash "mo:base/Hash";
import Nat "mo:base/Nat";
import Iter "mo:base/Iter";
import BufferUtils "./BufferUtils";

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
  };

  public func initStable() : StableState {
    {
      var nextRoomId = 0;
      var nextMessageId = 0;
      var nextItemTypeId = 0;
      var nextItemId = 0;
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
      var stableItemTypes = [];
      var stableItems = [];
    }
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