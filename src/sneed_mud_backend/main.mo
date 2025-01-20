import Principal "mo:base/Principal";
import Result "mo:base/Result";
import Types "./Types";
import State "./State";
import Lib "./lib";
import ItemManager "./ItemManager";
import TokenManager "./TokenManager";
import ICRC1 "./ICRC1";
import Debug "mo:base/Debug";
import Buffer "mo:base/Buffer";
import Option "mo:base/Option";
import ItemUtils "./ItemUtils";
import Time "mo:base/Time";
import Error "mo:base/Error";
import Array "mo:base/Array";
import Nat8 "mo:base/Nat8";
import Nat16 "mo:base/Nat16";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Nat "mo:base/Nat";
import Combat "./Combat";

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
    switch (State.findPrincipalByName(state, name)) {
      case (?_existingPrincipal) { true };
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

  public shared(msg) func say(message: Text) : async Result.Result<(), Text> {
    Lib.say(state, msg.caller, message)
  };

  public shared(msg) func whisper(targetName: Text, message: Text) : async Result.Result<(), Text> {
    Lib.whisper(state, msg.caller, targetName, message)
  };

  // Send a system message to a specific player
  public shared(msg) func sendSystemMessage(targetPrincipal: Principal, content: Text) : async Result.Result<(), Text> {
    // Only allow the canister itself to send system messages
    if (Principal.equal(msg.caller, Principal.fromActor(this))) {
      Lib.sendSystemMessage(state, targetPrincipal, content)
    } else {
      #err("Only the system can send system messages")
    }
  };

  // Handle token transfer notifications
  public shared(msg) func notifyTokenTransfer(
    senderPrincipal: Principal,
    recipientPrincipal: Principal,
    senderName: Text,
    recipientName: Text,
    amount: Text,
    tokenSymbol: Text,
    txId: Text
  ) : async Result.Result<(), Text> {
    // Verify that the caller is a registered player
    switch (state.players.get(msg.caller)) {
      case null { #err("Only registered players can send token transfer notifications") };
      case (?callerName) {
        // Verify that the caller is actually the sender
        if (not Principal.equal(msg.caller, senderPrincipal)) {
          return #err("You can only notify about your own transfers");
        };
        // Verify that the caller's name matches the provided sender name
        if (callerName != senderName) {
          return #err("Sender name mismatch");
        };

        // Create the messages
        let senderMessage = "You sent " # amount # " " # tokenSymbol # " to " # recipientName # " (Transaction ID: " # txId # ")";
        let recipientMessage = senderName # " sent you " # amount # " " # tokenSymbol # " (Transaction ID: " # txId # ")";

        // Send messages
        ignore Lib.sendSystemMessage(state, senderPrincipal, senderMessage);
        ignore Lib.sendSystemMessage(state, recipientPrincipal, recipientMessage);
        
        #ok(())
      };
    }
  };

  // Character creation and stats
  public shared(msg) func createCharacter() : async Result.Result<(), Text> {
    Lib.createCharacter(state, msg.caller)
  };

  public shared(msg) func getStats() : async Result.Result<Types.PlayerStats, Text> {
    Lib.getPlayerStats(state, msg.caller)
  };

  // Update look command to show player stats
  public shared(msg) func lookAtPlayer(targetName: Text) : async Result.Result<Types.PlayerStats, Text> {
    // First check if the target exists
    switch (State.findPrincipalByName(state, targetName)) {
      case null { #err("Player not found: " # targetName) };
      case (?targetPrincipal) {
        // Get target's stats
        Lib.getPlayerStats(state, targetPrincipal)
      };
    }
  };

  // Combat system
  public shared(msg) func attack(targetName: Text) : async Result.Result<(), Text> {
    await Combat.processPlayerAttack(state, msg.caller, targetName)
  };

  public shared(msg) func respawn() : async Result.Result<(), Text> {
    let result = Combat.processPlayerRespawn(state, msg.caller);
    result
  };

  // Get a player's principal from their name
  public query func getPrincipalByName(name : Text) : async Result.Result<Principal, Text> {
    switch (State.findPrincipalByName(state, name)) {
      case null { #err("Player not found") };
      case (?principal) { #ok(principal) };
    }
  };

  // Token management methods
  public shared(msg) func registerToken(ledgerCanisterId: Principal) : async Result.Result<(), Text> {
    let token : ICRC1.Token = actor(Principal.toText(ledgerCanisterId));
    
    // Fetch metadata and fee
    try {
      let metadata = await token.icrc1_metadata();
      let fee = await token.icrc1_fee();
      
      // Extract name, symbol, decimals from metadata
      var name = "";
      var symbol = "";
      var decimals = 8; // Default value
      
      for ((key, value) in metadata.vals()) {
        switch (key) {
          case "icrc1:name" {
            switch (value) {
              case (#Text(val)) { name := val };
              case _ {};
            };
          };
          case "icrc1:symbol" {
            switch (value) {
              case (#Text(val)) { symbol := val };
              case _ {};
            };
          };
          case "icrc1:decimals" {
            switch (value) {
              case (#Nat(val)) { decimals := val };
              case (#Nat8(val)) { decimals := Nat8.toNat(val) };
              case (#Nat16(val)) { decimals := Nat16.toNat(val) };
              case (#Nat32(val)) { decimals := Nat32.toNat(val) };
              case (#Nat64(val)) { decimals := Nat64.toNat(val) };
              case _ {};
            };
          };
          case _ {};
        };
      };
      
      // Create metadata record
      let tokenMetadata : Types.TokenMetadata = {
        name = name;
        symbol = symbol;
        decimals = decimals;
        fee = fee;
        lastRefreshed = Time.now();
      };
      
      // Register token for user
      TokenManager.registerToken(state, msg.caller, ledgerCanisterId, tokenMetadata)
    }
    catch (e) {
      #err("Failed to fetch token metadata: " # Error.message(e))
    }
  };

  public shared(msg) func unregisterToken(ledgerCanisterId: Principal) : async Result.Result<(), Text> {
    TokenManager.unregisterToken(state, msg.caller, ledgerCanisterId)
  };

  public query(msg) func getRegisteredTokens() : async Result.Result<[Types.TokenInfo], Text> {
    TokenManager.getRegisteredTokens(state, msg.caller)
  };

  public shared(msg) func refreshTokenMetadata() : async Result.Result<(), Text> {
    switch (await getRegisteredTokens()) {
      case (#err(e)) { #err(e) };
      case (#ok(tokens)) {
        let staleIds = Array.mapFilter<Types.TokenInfo, Principal>(tokens, func(t) {
          if (Option.isNull(t.metadata)) { ?t.ledgerCanisterId } else { null }
        });
        
        if (staleIds.size() == 0) {
          return #ok(());
        };
        
        // Refresh metadata for stale tokens
        for (tokenId in staleIds.vals()) {
          try {
            let token = actor (Principal.toText(tokenId)) : ICRC1.Token;
            let metadata = await token.icrc1_metadata();
            let fee = await token.icrc1_fee();
            
            let tokenMetadata : Types.TokenMetadata = {
              name = "";  // Will be populated from metadata
              symbol = "";  // Will be populated from metadata
              decimals = 8;  // Default, will be overridden
              fee = fee;
              lastRefreshed = Time.now()
            };
            
            // Extract name, symbol, decimals from metadata
            var updatedMetadata = tokenMetadata;
            for (entry in metadata.vals()) {
              let key = entry.0;
              let value = entry.1;
              updatedMetadata := switch (key, value) {
                case ("icrc1:name", #Text(name)) { 
                  { updatedMetadata with name = name } 
                };
                case ("icrc1:symbol", #Text(symbol)) { 
                  { updatedMetadata with symbol = symbol } 
                };
                case ("icrc1:decimals", value) {
                  let decimals = switch value {
                    case (#Nat8(n)) { Nat8.toNat(n) };
                    case (#Nat16(n)) { Nat16.toNat(n) };
                    case (#Nat32(n)) { Nat32.toNat(n) };
                    case (#Nat64(n)) { Nat64.toNat(n) };
                    case (#Nat(n)) { n };
                    case _ { updatedMetadata.decimals };
                  };
                  { updatedMetadata with decimals = decimals }
                };
                case _ { updatedMetadata };
              };
            };
            
            ignore TokenManager.updateTokenMetadata(state, msg.caller, tokenId, updatedMetadata);
          } catch (e) {
            // Log error but continue with other tokens
            Debug.print("Error refreshing metadata for token: " # Principal.toText(tokenId) # " - " # Error.message(e));
          };
        };
        
        #ok(())
      };
    }
  };
}
