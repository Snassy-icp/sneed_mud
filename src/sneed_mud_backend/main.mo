import Principal "mo:base/Principal";
import HashMap "mo:base/HashMap";
import Text "mo:base/Text";
import Iter "mo:base/Iter";
import Result "mo:base/Result";
import Buffer "mo:base/Buffer";
import Debug "mo:base/Debug";
import Nat "mo:base/Nat";
import Hash "mo:base/Hash";
import Array "mo:base/Array";
import Option "mo:base/Option";
import Types "./Types";

actor {
  type Room = Types.Room;
  type RoomId = Types.RoomId;
  type Exit = Types.Exit;

  // Stable storage
  private stable var playerEntries : [(Principal, Text)] = [];
  private stable var roomEntries : [(RoomId, Room)] = [];
  private stable var playerLocationEntries : [(Principal, RoomId)] = [];

  private stable var nextRoomId : Nat = 0;

  // Runtime state
  private var players = HashMap.fromIter<Principal, Text>(playerEntries.vals(), 100, Principal.equal, Principal.hash);
  private var usedNames = HashMap.fromIter<Text, Principal>(
    Array.map<(Principal, Text), (Text, Principal)>(
      playerEntries,
      func ((p, n) : (Principal, Text)) : (Text, Principal) = (n, p)
    ).vals(),
    100,
    Text.equal,
    Text.hash
  );
  private var rooms = HashMap.fromIter<RoomId, Room>(roomEntries.vals(), 100, Nat.equal, Hash.hash);
  private var playerLocations = HashMap.fromIter<Principal, RoomId>(playerLocationEntries.vals(), 100, Principal.equal, Principal.hash);

  let starting_room : RoomId = 0;

  // System upgrade hooks
  system func preupgrade() {
    playerEntries := Iter.toArray(players.entries());
    roomEntries := Iter.toArray(rooms.entries());
    playerLocationEntries := Iter.toArray(playerLocations.entries());
  };

  system func postupgrade() {
    // Clear stable storage after initializing HashMaps
    playerEntries := [];
    roomEntries := [];
    playerLocationEntries := [];
  };

  // Room management functions
  public shared(msg) func createRoom(name: Text, description: Text) : async Result.Result<RoomId, Text> {
    let roomId = nextRoomId;
    nextRoomId += 1;

    let newRoom : Room = {
      id = roomId;
      name = name;
      description = description;
      exits = [];
    };

    rooms.put(roomId, newRoom);
    #ok(roomId)
  };

  public shared(msg) func addExit(
    fromRoomId: RoomId, 
    exitId: Text,
    name: Text, 
    description: Text, 
    targetRoomId: RoomId,
    direction: ?Text
  ) : async Result.Result<(), Text> {
    switch (rooms.get(fromRoomId)) {
      case null { #err("Source room not found") };
      case (?room) {
        switch (rooms.get(targetRoomId)) {
          case null { #err("Target room not found") };
          case (?_) {
            let newExit : Exit = {
              name = name;
              description = description;
              targetRoomId = targetRoomId;
              direction = direction;
            };

            let existingExits = Buffer.Buffer<(Text, Exit)>(room.exits.size());
            for (exit in room.exits.vals()) {
              existingExits.add(exit);
            };
            existingExits.add((exitId, newExit));

            let updatedRoom : Room = {
              id = room.id;
              name = room.name;
              description = room.description;
              exits = Buffer.toArray(existingExits);
            };

            rooms.put(fromRoomId, updatedRoom);
            #ok(())
          };
        };
      };
    };
  };

  public query func getRoom(roomId: RoomId) : async ?Room {
    rooms.get(roomId)
  };

  // Register a new player name
  public shared(msg) func registerPlayerName(name : Text) : async Result.Result<Text, Text> {
    let caller = msg.caller;
    
    // Check if name is empty or too long
    if (Text.size(name) == 0) {
      return #err("Name cannot be empty");
    };
    if (Text.size(name) > 20) {
      return #err("Name cannot be longer than 20 characters");
    };

    // Check if name is already taken
    switch (usedNames.get(name)) {
      case (?_existingPrincipal) {
        return #err("Name is already taken");
      };
      case null {
        // Check if player already has a name
        switch (players.get(caller)) {
          case (?existingName) {
            return #err("You already have a name: " # existingName);
          };
          case null {
            // Register the new name
            players.put(caller, name);
            usedNames.put(name, caller);
            
            // Place player in starting room (room 0) if it exists
            switch (rooms.get(starting_room)) {
              case (?_) {
                playerLocations.put(caller, starting_room);
                return #ok("Successfully registered as " # name # " and entered the starting room");
              };
              case null {
                return #ok("Successfully registered as " # name # " (no starting room available)");
              };
            };
          };
        };
      };
    };
  };

  // Query a player's name
  public query func getPlayerName(principal : Principal) : async ?Text {
    players.get(principal)
  };

  // Query if a name is taken
  public query func isNameTaken(name : Text) : async Bool {
    switch (usedNames.get(name)) {
      case (?_principal) { true };
      case null { false };
    }
  };

  // Clear all player data (for development purposes)
  public func clearAllPlayers() : async () {
    playerEntries := [];
    players := HashMap.HashMap<Principal, Text>(0, Principal.equal, Principal.hash);
    usedNames := HashMap.HashMap<Text, Principal>(0, Text.equal, Text.hash);
  };

  // Private helper to get current room with fallback logic
  private func getCurrentRoomInternal(caller: Principal) : Result.Result<Room, Text> {
    switch (playerLocations.get(caller)) {
      case null { 
        // Player not in any room, try to use starting room
        switch (rooms.get(starting_room)) {
          case null { #err("No rooms available - not even starting room") };
          case (?room) { #ok(room) };
        };
      };
      case (?roomId) {
        switch (rooms.get(roomId)) {
          case null {
            // Current room not found, fall back to starting room
            switch (rooms.get(starting_room)) {
              case null { #err("Current room not found and starting room unavailable") };
              case (?room) { 
                // Update player location to starting room
                playerLocations.put(caller, starting_room);
                #ok(room) 
              };
            };
          };
          case (?room) { #ok(room) };
        };
      };
    };
  };

  // Player location functions
  public query(msg) func getCurrentRoom() : async Result.Result<Room, Text> {
    getCurrentRoomInternal(msg.caller)
  };

  // Private helper for exit usage logic
  private func useExitInternal(caller: Principal, exitId: Text) : Result.Result<Room, Text> {
    // Check if player is registered
    switch (players.get(caller)) {
      case null { return #err("You need to register a name first") };
      case (?_) {};
    };
    
    // Get player's current room
    switch (getCurrentRoomInternal(caller)) {
      case (#err(e)) { return #err(e) };
      case (#ok(currentRoom)) {
        // Find the exit
        for ((id, exit) in currentRoom.exits.vals()) {
          if (id == exitId) {
            // Found the exit, try to move to target room
            switch (rooms.get(exit.targetRoomId)) {
              case null { return #err("Target room not found") };
              case (?targetRoom) {
                playerLocations.put(caller, exit.targetRoomId);
                return #ok(targetRoom);
              };
            };
          };
        };
        return #err("Exit not found");
      };
    };
  };

  public shared(msg) func useExit(exitId: Text) : async Result.Result<Room, Text> {
    useExitInternal(msg.caller, exitId)
  };

  public shared(msg) func test_useExit(principal : Principal, exitId: Text) : async Result.Result<Room, Text> {
    useExitInternal(principal, exitId)
  };

  public shared(msg) func getPlayersInRoom(roomId: RoomId) : async Result.Result<[(Principal, Text)], Text> {
    switch (rooms.get(roomId)) {
      case null { #err("Room not found") };
      case (?_) {
        let playersHere = Buffer.Buffer<(Principal, Text)>(0);
        for ((principal, location) in playerLocations.entries()) {
          if (location == roomId) {
            switch (players.get(principal)) {
              case (?name) { playersHere.add((principal, name)) };
              case null {}; // Skip players without names
            };
          };
        };
        #ok(Buffer.toArray(playersHere))
      };
    };
  };
};
