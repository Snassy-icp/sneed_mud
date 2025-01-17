import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Result "mo:base/Result";
import Debug "mo:base/Debug";
import Time "mo:base/Time";
import Nat "mo:base/Nat";
import Buffer "mo:base/Buffer";
import Types "./Types";
import State "./State";
import BufferUtils "./BufferUtils";

module {
  type Room = Types.Room;
  type RoomId = Types.RoomId;
  type Exit = Types.Exit;
  type LogMessage = Types.LogMessage;
  type MessageId = Types.MessageId;
  type CircularBuffer = Types.CircularBuffer;
  type MudState = State.MudState;

  let starting_room : RoomId = 0;

  // Message log functions
  private func ensureMessageLog(state: MudState, p: Principal) {
    switch (state.messageLogs.get(p)) {
      case null {
        state.messageLogs.put(p, BufferUtils.createCircularBuffer());
      };
      case (?_) {};
    };
  };

  private func addMessageToLog(state: MudState, p: Principal, content: Text) {
    Debug.print("Adding message for principal: " # Principal.toText(p));
    Debug.print("Message content: " # content);
    ensureMessageLog(state, p);
    switch (state.messageLogs.get(p)) {
      case null { /* impossible due to ensureMessageLog */ };
      case (?cb) {
        let msg : LogMessage = {
          id = state.stable_state.nextMessageId;
          timestamp = Time.now();
          content = content;
        };
        state.stable_state.nextMessageId += 1;
        BufferUtils.addToCircularBuffer(cb, msg);
        Debug.print("Message added with ID: " # Nat.toText(msg.id));
      };
    };
  };

  private func broadcastToRoom(state: MudState, roomId: RoomId, content: Text) {
    for ((principal, location) in state.playerLocations.entries()) {
      if (location == roomId) {
        addMessageToLog(state, principal, content);
      };
    };
  };

  private func broadcastToRoomExcept(state: MudState, roomId: RoomId, excludePrincipal: Principal, content: Text) {
    for ((principal, location) in state.playerLocations.entries()) {
      if (location == roomId and principal != excludePrincipal) {
        addMessageToLog(state, principal, content);
      };
    };
  };

  public func getMessages(state: MudState, caller: Principal, afterId: ?MessageId) : [LogMessage] {
    Debug.print("Getting messages for principal: " # Principal.toText(caller));
    
    switch (state.messageLogs.get(caller)) {
      case null { 
        Debug.print("No message log found for principal");
        [] 
      };
      case (?cb) {
        Debug.print("Found message log with size: " # Nat.toText(cb.size));
        
        // Short circuit if we know there are no newer messages
        switch (afterId, cb.highestId) {
          case (?requestedId, ?maxId) {
            if (requestedId >= maxId) {
              Debug.print("No new messages after ID: " # Nat.toText(requestedId));
              return [];
            };
          };
          case (_, _) {};
        };

        switch (afterId) {
          case null {
            // Return last 100 messages
            let messages = BufferUtils.getLastNFromCircularBuffer(cb, 100);
            Debug.print("Returning messages count: " # Nat.toText(messages.size()));
            messages
          };
          case (?id) {
            // Return messages strictly after the given id
            let messages = BufferUtils.getFromCircularBuffer(cb, 0, cb.size);
            let result = Buffer.Buffer<LogMessage>(0);
            for (msg in messages.vals()) {
              if (msg.id > id) {
                result.add(msg);
              };
            };
            Debug.print("Returning messages after ID: " # Nat.toText(id));
            Buffer.toArray(result)
          };
        }
      };
    }
  };

  // Room management functions
  public func createRoom(state: MudState, caller: Principal, name: Text, description: Text) : Result.Result<RoomId, Text> {
    // Only realm owners can create rooms
    if (not State.isRealmOwner(state, caller)) {
      return #err("Only realm owners can create rooms");
    };

    let roomId = state.stable_state.nextRoomId;
    state.stable_state.nextRoomId += 1;

    let newRoom : Room = {
      id = roomId;
      name = name;
      description = description;
      exits = [];
      owners = [caller];  // Creator becomes the first owner
    };

    state.rooms.put(roomId, newRoom);
    #ok(roomId)
  };

  public func updateRoom(state: MudState, caller: Principal, roomId: RoomId, name: Text, description: Text) : Result.Result<(), Text> {
    switch (state.rooms.get(roomId)) {
      case null { #err("Room not found") };
      case (?room) {
        if (not State.hasRoomAccess(state, room, caller)) {
          return #err("You don't have permission to modify this room");
        };

        let updatedRoom : Room = {
          id = room.id;
          name = name;
          description = description;
          exits = room.exits;
          owners = room.owners;
        };
        state.rooms.put(roomId, updatedRoom);
        #ok(())
      };
    };
  };

  public func addRoomOwner(state: MudState, caller: Principal, roomId: RoomId, newOwner: Principal) : Result.Result<(), Text> {
    switch (state.rooms.get(roomId)) {
      case null { #err("Room not found") };
      case (?room) {
        if (not State.hasRoomAccess(state, room, caller)) {
          return #err("You don't have permission to modify this room's ownership");
        };

        // Check if already an owner
        for (owner in room.owners.vals()) {
          if (Principal.equal(owner, newOwner)) {
            return #err("Principal is already an owner of this room");
          };
        };

        // Add new owner
        let existingOwners = Buffer.Buffer<Principal>(room.owners.size() + 1);
        for (owner in room.owners.vals()) {
          existingOwners.add(owner);
        };
        existingOwners.add(newOwner);

        let updatedRoom : Room = {
          id = room.id;
          name = room.name;
          description = room.description;
          exits = room.exits;
          owners = Buffer.toArray(existingOwners);
        };
        state.rooms.put(roomId, updatedRoom);
        #ok(())
      };
    };
  };

  public func removeRoomOwner(state: MudState, caller: Principal, roomId: RoomId, ownerToRemove: Principal) : Result.Result<(), Text> {
    switch (state.rooms.get(roomId)) {
      case null { #err("Room not found") };
      case (?room) {
        if (not State.hasRoomAccess(state, room, caller)) {
          return #err("You don't have permission to modify this room's ownership");
        };

        // Prevent removing the last owner
        if (room.owners.size() <= 1) {
          return #err("Cannot remove the last owner of a room");
        };

        // Remove owner
        let remainingOwners = Buffer.Buffer<Principal>(room.owners.size());
        var found = false;
        for (owner in room.owners.vals()) {
          if (not Principal.equal(owner, ownerToRemove)) {
            remainingOwners.add(owner);
          } else {
            found := true;
          };
        };

        if (not found) {
          return #err("Principal is not an owner of this room");
        };

        let updatedRoom : Room = {
          id = room.id;
          name = room.name;
          description = room.description;
          exits = room.exits;
          owners = Buffer.toArray(remainingOwners);
        };
        state.rooms.put(roomId, updatedRoom);
        #ok(())
      };
    };
  };

  public func updateExit(
    state: MudState,
    caller: Principal,
    fromRoomId: RoomId,
    exitId: Text,
    name: Text,
    description: Text,
    targetRoomId: RoomId,
    direction: ?Text
  ) : Result.Result<(), Text> {
    switch (state.rooms.get(fromRoomId)) {
      case null { #err("Source room not found") };
      case (?room) {
        if (not State.hasRoomAccess(state, room, caller)) {
          return #err("You don't have permission to modify exits in this room");
        };

        switch (state.rooms.get(targetRoomId)) {
          case null { #err("Target room not found") };
          case (?_) {
            // Find and update the specific exit
            let existingExits = Buffer.Buffer<(Text, Exit)>(room.exits.size());
            var exitFound = false;

            for ((id, exit) in room.exits.vals()) {
              if (id == exitId) {
                // Update this exit
                let updatedExit : Exit = {
                  name = name;
                  description = description;
                  targetRoomId = targetRoomId;
                  direction = direction;
                };
                existingExits.add((exitId, updatedExit));
                exitFound := true;
              } else {
                existingExits.add((id, exit));
              };
            };

            if (not exitFound) {
              return #err("Exit not found");
            };

            let updatedRoom : Room = {
              id = room.id;
              name = room.name;
              description = room.description;
              exits = Buffer.toArray(existingExits);
              owners = room.owners;
            };

            state.rooms.put(fromRoomId, updatedRoom);
            #ok(())
          };
        };
      };
    };
  };

  public func addExit(
    state: MudState,
    caller: Principal,
    fromRoomId: RoomId, 
    exitId: Text,
    name: Text, 
    description: Text, 
    targetRoomId: RoomId,
    direction: ?Text
  ) : Result.Result<(), Text> {
    switch (state.rooms.get(fromRoomId)) {
      case null { #err("Source room not found") };
      case (?room) {
        if (not State.hasRoomAccess(state, room, caller)) {
          return #err("You don't have permission to add exits to this room");
        };

        switch (state.rooms.get(targetRoomId)) {
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
              owners = room.owners;
            };

            state.rooms.put(fromRoomId, updatedRoom);
            #ok(())
          };
        };
      };
    };
  };

  // Player management functions
  public func registerPlayerName(state: MudState, caller: Principal, name : Text) : Result.Result<Text, Text> {
    // Check if name is empty or too long
    if (Text.size(name) == 0) {
      return #err("Name cannot be empty");
    };
    if (Text.size(name) > 20) {
      return #err("Name cannot be longer than 20 characters");
    };

    // Check if name is already taken
    switch (state.usedNames.get(name)) {
      case (?_existingPrincipal) {
        return #err("Name is already taken");
      };
      case null {
        // Check if player already has a name
        switch (state.players.get(caller)) {
          case (?existingName) {
            return #err("You already have a name: " # existingName);
          };
          case null {
            // Register the new name
            state.players.put(caller, name);
            state.usedNames.put(name, caller);
            
            // Add welcome message to player's log
            addMessageToLog(state, caller, "Welcome to the game, " # name # "!");
            
            // Place player in starting room (room 0) if it exists
            switch (state.rooms.get(starting_room)) {
              case (?room) {
                state.playerLocations.put(caller, starting_room);
                broadcastToRoomExcept(state, starting_room, caller, name # " has entered the game");
                
                // List other players in the room
                let otherPlayers = getPlayersInRoomExcept(state, starting_room, caller);
                if (otherPlayers.size() > 0) {
                  addMessageToLog(state, caller, formatPlayerList(otherPlayers));
                };
                
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

  // Private helper to get current room with fallback logic
  public func getCurrentRoom(state: MudState, caller: Principal) : Result.Result<Room, Text> {
    switch (state.playerLocations.get(caller)) {
      case null { 
        // Player not in any room, try to use starting room
        switch (state.rooms.get(starting_room)) {
          case null { #err("No rooms available - not even starting room") };
          case (?room) { #ok(room) };
        };
      };
      case (?roomId) {
        switch (state.rooms.get(roomId)) {
          case null {
            // Current room not found, fall back to starting room
            switch (state.rooms.get(starting_room)) {
              case null { #err("Current room not found and starting room unavailable") };
              case (?room) { 
                // Update player location to starting room
                state.playerLocations.put(caller, starting_room);
                #ok(room) 
              };
            };
          };
          case (?room) { #ok(room) };
        };
      };
    };
  };

  // Helper function to format a list of players
  private func formatPlayerList(names: [Text]) : Text {
    switch (names.size()) {
      case 0 { "" };
      case 1 { names[0] # " is here" };
      case 2 { names[0] # " and " # names[1] # " are here" };
      case _ {
        let last = names.size() - 1;
        var result = "";
        var i = 0;
        while (i < last - 1) {
          result := result # names[i] # ", ";
          i += 1;
        };
        result # names[last - 1] # " and " # names[last] # " are here"
      };
    };
  };

  // Helper function to get list of players in a room except one player
  private func getPlayersInRoomExcept(state: MudState, roomId: RoomId, excludePrincipal: Principal) : [Text] {
    let players = Buffer.Buffer<Text>(0);
    for ((principal, location) in state.playerLocations.entries()) {
      if (location == roomId and principal != excludePrincipal) {
        switch (state.players.get(principal)) {
          case (?name) { players.add(name) };
          case null {}; // Skip players without names
        };
      };
    };
    Buffer.toArray(players)
  };

  public func useExit(state: MudState, caller: Principal, exitId: Text) : Result.Result<Room, Text> {
    // Check if player is registered
    switch (state.players.get(caller)) {
      case null { return #err("You need to register a name first") };
      case (?playerName) {
        // Get player's current room
        switch (getCurrentRoom(state, caller)) {
          case (#err(e)) { return #err(e) };
          case (#ok(currentRoom)) {
            // Find the exit (case-insensitive comparison)
            let lowerExitId = Text.toLowercase(exitId);
            for ((id, exit) in currentRoom.exits.vals()) {
              if (Text.toLowercase(id) == lowerExitId) {
                // Found the exit, try to move to target room
                switch (state.rooms.get(exit.targetRoomId)) {
                  case null { return #err("Target room not found") };
                  case (?targetRoom) {
                    // Send departure messages
                    broadcastToRoomExcept(state, currentRoom.id, caller, playerName # " leaves through " # exit.name);
                    addMessageToLog(state, caller, "You leave through " # exit.name);
                    
                    // Move player
                    state.playerLocations.put(caller, exit.targetRoomId);
                    
                    // Send arrival messages
                    broadcastToRoomExcept(state, targetRoom.id, caller, playerName # " arrives from " # currentRoom.name);
                    addMessageToLog(state, caller, "You arrive in " # targetRoom.name);
                    
                    // List other players in the room
                    let otherPlayers = getPlayersInRoomExcept(state, targetRoom.id, caller);
                    if (otherPlayers.size() > 0) {
                      addMessageToLog(state, caller, formatPlayerList(otherPlayers));
                    };
                    
                    return #ok(targetRoom);
                  };
                };
              };
            };
            return #err("Exit not found");
          };
        };
      };
    };
  };

  public func getPlayersInRoom(state: MudState, roomId: RoomId) : Result.Result<[(Principal, Text)], Text> {
    switch (state.rooms.get(roomId)) {
      case null { #err("Room not found") };
      case (?_) {
        let playersHere = Buffer.Buffer<(Principal, Text)>(0);
        for ((principal, location) in state.playerLocations.entries()) {
          if (location == roomId) {
            switch (state.players.get(principal)) {
              case (?name) { playersHere.add((principal, name)) };
              case null {}; // Skip players without names
            };
          };
        };
        #ok(Buffer.toArray(playersHere))
      };
    };
  };

  public func clearPlayer(state: MudState, principal: Principal) {
    // Remove from players HashMap and usedNames
    switch (state.players.get(principal)) {
      case (?name) {
        state.players.delete(principal);
        state.usedNames.delete(name);
      };
      case null {};
    };

    // Remove from playerLocations
    state.playerLocations.delete(principal);

    // Remove from messageLogs
    state.messageLogs.delete(principal);
  };

  public func say(state: MudState, caller: Principal, message: Text) : Result.Result<(), Text> {
    switch (state.players.get(caller)) {
      case null { #err("You need to register a name first") };
      case (?playerName) {
        switch (state.playerLocations.get(caller)) {
          case null { #err("You're not in any room") };
          case (?roomId) {
            // Send personalized message to the speaker
            addMessageToLog(state, caller, "You say: " # message);
            
            // Broadcast to others in the room
            for ((principal, location) in state.playerLocations.entries()) {
              if (location == roomId and principal != caller) {
                addMessageToLog(state, principal, playerName # " says: " # message);
              };
            };
            #ok(())
          };
        };
      };
    };
  };

  public func whisper(state: MudState, caller: Principal, targetName: Text, message: Text) : Result.Result<(), Text> {
    switch (state.players.get(caller)) {
      case null { #err("You need to register a name first") };
      case (?playerName) {
        // Find the target player's principal by their name
        switch (state.usedNames.get(targetName)) {
          case null { #err("Player '" # targetName # "' not found") };
          case (?targetPrincipal) {
            // Send personalized messages to both players
            addMessageToLog(state, caller, "You whisper to " # targetName # ": " # message);
            addMessageToLog(state, targetPrincipal, playerName # " whispers to you: " # message);
            #ok(())
          };
        };
      };
    };
  };

  // Realm management functions
  public func addRealmOwner(state: MudState, caller: Principal, newOwner: Principal) : Result.Result<(), Text> {
    // Special case: if there are no realm owners, allow setting the first one
    if (state.realmConfig.owners.size() == 0) {
      let newConfig = {
        name = state.realmConfig.name;
        description = state.realmConfig.description;
        owners = [newOwner];
      };
      state.realmConfig := newConfig;
      return #ok(());
    };

    // Normal case: only existing realm owners can add new ones
    if (not State.isRealmOwner(state, caller)) {
      return #err("Only realm owners can add new realm owners");
    };

    // Check if already an owner
    for (owner in state.realmConfig.owners.vals()) {
      if (Principal.equal(owner, newOwner)) {
        return #err("Principal is already a realm owner");
      };
    };

    // Add new owner
    let existingOwners = Buffer.Buffer<Principal>(state.realmConfig.owners.size() + 1);
    for (owner in state.realmConfig.owners.vals()) {
      existingOwners.add(owner);
    };
    existingOwners.add(newOwner);
    
    let newConfig = {
      name = state.realmConfig.name;
      description = state.realmConfig.description;
      owners = Buffer.toArray(existingOwners);
    };
    state.realmConfig := newConfig;
    #ok(())
  };

  public func removeRealmOwner(state: MudState, caller: Principal, ownerToRemove: Principal) : Result.Result<(), Text> {
    if (not State.isRealmOwner(state, caller)) {
      return #err("Only realm owners can remove realm owners");
    };

    // Prevent removing the last owner
    if (state.realmConfig.owners.size() <= 1) {
      return #err("Cannot remove the last realm owner");
    };

    // Remove owner
    let remainingOwners = Buffer.Buffer<Principal>(state.realmConfig.owners.size());
    var found = false;
    for (owner in state.realmConfig.owners.vals()) {
      if (not Principal.equal(owner, ownerToRemove)) {
        remainingOwners.add(owner);
      } else {
        found := true;
      };
    };

    if (not found) {
      return #err("Principal is not a realm owner");
    };

    let newConfig = {
      name = state.realmConfig.name;
      description = state.realmConfig.description;
      owners = Buffer.toArray(remainingOwners);
    };
    state.realmConfig := newConfig;
    #ok(())
  };

  public func updateRealmInfo(state: MudState, caller: Principal, name: Text, description: Text) : Result.Result<(), Text> {
    if (not State.isRealmOwner(state, caller)) {
      return #err("Only realm owners can update realm information");
    };

    let newConfig = {
      name = name;
      description = description;
      owners = state.realmConfig.owners;
    };
    state.realmConfig := newConfig;
    #ok(())
  };

  public func getOwnedRooms(state: MudState, principal: Principal) : [(RoomId, Room)] {
    let ownedRooms = Buffer.Buffer<(RoomId, Room)>(0);
    for ((roomId, room) in state.rooms.entries()) {
      if (State.isRoomOwner(room, principal)) {
        ownedRooms.add((roomId, room));
      };
    };
    Buffer.toArray(ownedRooms)
  };
} 