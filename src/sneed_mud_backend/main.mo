import Principal "mo:base/Principal";
import Result "mo:base/Result";
import Types "./Types";
import State "./State";
import Lib "./lib";
import ItemManager "./ItemManager";
import Debug "mo:base/Debug";
import Buffer "mo:base/Buffer";
import Option "mo:base/Option";
import ItemUtils "./ItemUtils";

actor class MudBackend() = this {
  let starting_room : Types.RoomId = 0;

  private stable var stable_state : State.StableState = State.initStable();
  private var state : State.MudState = State.init(stable_state);

  system func preupgrade() {
    stable_state := State.preupgrade(state);
  };

  system func postupgrade() {
    state := State.init(stable_state);
  };

  // Item management functions
  public shared(msg) func createItemType(
    name: Text,
    description: Text,
    is_container: Bool,
    container_capacity: ?Nat,
    icon_url: Text,
    stack_max: Nat
  ) : async Result.Result<Types.ItemTypeId, Text> {
    ItemManager.createItemType(state, msg.caller, name, description, is_container, container_capacity, icon_url, stack_max)
  };

  public shared(msg) func createItem(typeId: Types.ItemTypeId, count: ?Nat) : async Result.Result<Types.ItemId, Text> {
    ItemManager.createItem(state, msg.caller, typeId, count)
  };

  public shared(msg) func transferItem(itemId: Types.ItemId, newOwner: Types.Account, transferCount: ?Nat) : async Result.Result<(), Text> {
    ItemManager.transferItem(state, msg.caller, itemId, newOwner, transferCount)
  };

  public shared(msg) func deleteItem(itemId: Types.ItemId) : async Result.Result<(), Text> {
    ItemManager.deleteItem(state, msg.caller, itemId)
  };

  // Container management functions
  public shared(msg) func toggleContainer(containerId: Types.ItemId) : async Result.Result<Bool, Text> {
    ItemManager.toggleContainer(state, msg.caller, containerId)
  };

  public shared(msg) func getContainerContents(containerId: Types.ItemId) : async Result.Result<[Types.ItemId], Text> {
    ItemManager.getContainerContents(state, msg.caller, containerId)
  };

  public query func hasContainerSpace(containerId: Types.ItemId) : async Result.Result<Bool, Text> {
    ItemManager.hasContainerSpace(state, containerId)
  };

  // Existing functions...
  public query(msg) func getMessages(afterId: ?Types.MessageId) : async [Types.LogMessage] {
    Lib.getMessages(state, msg.caller, afterId)
  };

  public query func test_getMessages(principal : Principal, afterId: ?Types.MessageId) : async [Types.LogMessage] {
    Lib.getMessages(state, principal, afterId)
  };

  public shared(msg) func createRoom(name: Text, description: Text) : async Result.Result<Types.RoomId, Text> {
    Lib.createRoom(state, msg.caller, name, description)
  };

  public shared(msg) func updateRoom(roomId: Types.RoomId, name: Text, description: Text) : async Result.Result<(), Text> {
    Lib.updateRoom(state, msg.caller, roomId, name, description)
  };

  public shared(msg) func updateExit(
    fromRoomId: Types.RoomId,
    exitId: Text,
    name: Text,
    description: Text,
    targetRoomId: Types.RoomId,
    direction: ?Text
  ) : async Result.Result<(), Text> {
    Lib.updateExit(state, msg.caller, fromRoomId, exitId, name, description, targetRoomId, direction)
  };

  public shared(msg) func addExit(
    fromRoomId: Types.RoomId, 
    exitId: Text,
    name: Text, 
    description: Text, 
    targetRoomId: Types.RoomId,
    direction: ?Text
  ) : async Result.Result<(), Text> {
    Lib.addExit(state, msg.caller, fromRoomId, exitId, name, description, targetRoomId, direction)
  };

  // Room ownership management
  public shared(msg) func addRoomOwner(roomId: Types.RoomId, newOwner: Principal) : async Result.Result<(), Text> {
    Lib.addRoomOwner(state, msg.caller, roomId, newOwner)
  };

  public shared(msg) func removeRoomOwner(roomId: Types.RoomId, ownerToRemove: Principal) : async Result.Result<(), Text> {
    Lib.removeRoomOwner(state, msg.caller, roomId, ownerToRemove)
  };

  // Realm management
  public query func getRealmInfo() : async Types.RealmConfig {
    state.realmConfig
  };

  public query func isRealmOwner(principal: Principal) : async Bool {
    State.isRealmOwner(state, principal)
  };

  public query func isRoomOwner(roomId: Types.RoomId, principal: Principal) : async Bool {
    switch (state.rooms.get(roomId)) {
      case null { false };
      case (?room) { State.isRoomOwner(room, principal) };
    }
  };

  public query func getRoomOwners(roomId: Types.RoomId) : async Result.Result<[Principal], Text> {
    switch (state.rooms.get(roomId)) {
      case null { #err("Room not found") };
      case (?room) { #ok(room.owners) };
    }
  };

  public query func getRoom(roomId: Types.RoomId) : async ?Types.Room {
    state.rooms.get(roomId)
  };

  public shared(msg) func registerPlayerName(name : Text) : async Result.Result<Text, Text> {
    Lib.registerPlayerName(state, msg.caller, name)
  };

  public query func getPlayerName(principal : Principal) : async ?Text {
    state.players.get(principal)
  };

  public query func isNameTaken(name : Text) : async Bool {
    switch (state.usedNames.get(name)) {
      case (?_principal) { true };
      case null { false };
    }
  };

  public func clearAllPlayers() : async () {
    for ((principal, _) in state.players.entries()) {
      Lib.clearPlayer(state, principal);
    };
  };

  public query(msg) func getCurrentRoom() : async Result.Result<Types.Room, Text> {
    Lib.getCurrentRoom(state, msg.caller)
  };

  public shared(msg) func useExit(exitId: Text) : async Result.Result<Types.Room, Text> {
    Lib.useExit(state, msg.caller, exitId)
  };

  public shared(msg) func test_useExit(principal : Principal, exitId: Text) : async Result.Result<Types.Room, Text> {
    Lib.useExit(state, principal, exitId)
  };

  public shared(msg) func getPlayersInRoom(roomId: Types.RoomId) : async Result.Result<[(Principal, Text)], Text> {
    Lib.getPlayersInRoom(state, roomId)
  };

  public shared(msg) func clearPlayer(principal: Principal) : async () {
    Lib.clearPlayer(state, principal)
  };

  // Realm management
  public shared(msg) func addRealmOwner(newOwner: Principal) : async Result.Result<(), Text> {
    Lib.addRealmOwner(state, msg.caller, newOwner)
  };

  public shared(msg) func removeRealmOwner(ownerToRemove: Principal) : async Result.Result<(), Text> {
    Lib.removeRealmOwner(state, msg.caller, ownerToRemove)
  };

  public shared(msg) func updateRealmInfo(name: Text, description: Text) : async Result.Result<(), Text> {
    Lib.updateRealmInfo(state, msg.caller, name, description)
  };

  // Room ownership queries
  public query func getOwnedRooms(principal: Principal) : async [(Types.RoomId, Types.Room)] {
    Lib.getOwnedRooms(state, principal)
  };

  // Get the principal of this canister
  public func getCanisterPrincipal() : async Principal {
    Principal.fromActor(this)
  };

  // Get items in player's inventory
  public shared(msg) func getItems() : async Result.Result<[Types.ItemInfo], Text> {
    let playerItems = Buffer.Buffer<Types.ItemInfo>(0);
    
    for ((itemId, item) in state.items.entries()) {
      // Check if item is owned by the player (no subaccount means player inventory)
      if (Principal.equal(item.owner.owner, msg.caller) and item.owner.subaccount == null) {
        switch (state.itemTypes.get(item.type_id)) {
          case null { /* Skip items with invalid type */ };
          case (?itemType) {
            playerItems.add({
              id = item.id;
              item_type = itemType;
              count = item.count;
              is_open = item.is_open;
            });
          };
        };
      };
    };
    
    #ok(Buffer.toArray(playerItems))
  };

  // Get items in a room
  public shared(msg) func getRoomItems(roomId: Types.RoomId) : async Result.Result<[Types.ItemInfo], Text> {
    let roomItems = Buffer.Buffer<Types.ItemInfo>(0);
    let roomSubaccount = ItemUtils.createRoomSubaccount(roomId);
    
    for ((itemId, item) in state.items.entries()) {
      // Check if item is owned by the room
      if (Principal.equal(item.owner.owner, Principal.fromActor(this)) and 
          item.owner.subaccount == ?roomSubaccount) {
        switch (state.itemTypes.get(item.type_id)) {
          case null { /* Skip items with invalid type */ };
          case (?itemType) {
            roomItems.add({
              id = item.id;
              item_type = itemType;
              count = item.count;
              is_open = item.is_open;
            });
          };
        };
      };
    };
    
    #ok(Buffer.toArray(roomItems))
  };

  // Get all item types
  public query func getItemTypes() : async Result.Result<[Types.ItemType], Text> {
    let types = Buffer.Buffer<Types.ItemType>(0);
    for ((_, itemType) in state.itemTypes.entries()) {
      types.add(itemType);
    };
    #ok(Buffer.toArray(types))
  };

  // Get a specific item type by ID
  public query func getItemType(typeId: Types.ItemTypeId) : async Result.Result<Types.ItemType, Text> {
    switch (state.itemTypes.get(typeId)) {
      case null { #err("Item type not found") };
      case (?itemType) { #ok(itemType) };
    }
  };

  // Get a specific item by ID
  public shared(msg) func getItem(itemId: Types.ItemId) : async Result.Result<Types.ItemInfo, Text> {
    switch (state.items.get(itemId)) {
      case null { #err("Item not found") };
      case (?item) {
        // Check if caller can access the item
        if (not ItemUtils.canAccessItem(state, itemId, msg.caller)) {
          return #err("You don't have access to this item");
        };

        switch (state.itemTypes.get(item.type_id)) {
          case null { #err("Item type not found") };
          case (?itemType) {
            #ok({
              id = item.id;
              item_type = itemType;
              count = item.count;
              is_open = item.is_open;
            })
          };
        }
      };
    }
  };
}
