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
  type CircularBuffer<T> = Types.CircularBuffer<T>;
  type MudState = State.MudState;

  let starting_room : RoomId = 0;

  // Message log functions
  private func ensureMessageLog(state: MudState, p: Principal) {
    switch (state.messageLogs.get(p)) {
      case null {
        state.messageLogs.put(p, BufferUtils.createCircularBuffer<LogMessage>());
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

  public func getMessagesInternal(state: MudState, caller: Principal, afterId: ?MessageId) : [LogMessage] {
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
  public func createRoom(state: MudState, name: Text, description: Text) : Result.Result<RoomId, Text> {
    let roomId = state.stable_state.nextRoomId;
    state.stable_state.nextRoomId += 1;

    let newRoom : Room = {
      id = roomId;
      name = name;
      description = description;
      exits = [];
    };

    state.rooms.put(roomId, newRoom);
    #ok(roomId)
  };

  public func addExit(
    state: MudState,
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
                broadcastToRoom(state, starting_room, name # " has entered the game");
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
  public func getCurrentRoomInternal(state: MudState, caller: Principal) : Result.Result<Room, Text> {
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

  public func useExitInternal(state: MudState, caller: Principal, exitId: Text) : Result.Result<Room, Text> {
    // Check if player is registered
    switch (state.players.get(caller)) {
      case null { return #err("You need to register a name first") };
      case (?playerName) {
        // Get player's current room
        switch (getCurrentRoomInternal(state, caller)) {
          case (#err(e)) { return #err(e) };
          case (#ok(currentRoom)) {
            // Find the exit
            for ((id, exit) in currentRoom.exits.vals()) {
              if (id == exitId) {
                // Found the exit, try to move to target room
                switch (state.rooms.get(exit.targetRoomId)) {
                  case null { return #err("Target room not found") };
                  case (?targetRoom) {
                    // Broadcast departure to current room
                    broadcastToRoom(state, currentRoom.id, playerName # " leaves through " # exit.name);
                    
                    // Move player
                    state.playerLocations.put(caller, exit.targetRoomId);
                    
                    // Broadcast arrival to new room
                    broadcastToRoom(state, targetRoom.id, playerName # " arrives from " # currentRoom.name);
                    
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
} 