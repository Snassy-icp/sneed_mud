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
import Array "mo:base/Array";
import HashMap "mo:base/HashMap";
import Hash "mo:base/Hash";
import Int "mo:base/Int";
import Class "./Class";

module {
  type Room = Types.Room;
  type RoomId = Types.RoomId;
  type Exit = Types.Exit;
  type LogMessage = Types.LogMessage;
  type MessageId = Types.MessageId;
  type CircularBuffer = Types.CircularBuffer;
  type MudState = State.MudState;

  let starting_room : RoomId = 0;

  // Constants for base stats
  let BASE_HP : Nat = 100;
  let BASE_MP : Nat = 50;
  let BASE_PHYSICAL_ATTACK : Nat = 10;
  let BASE_PHYSICAL_DEFENSE : Nat = 5;
  let BASE_MAGIC_ATTACK : Nat = 10;
  let BASE_MAGIC_DEFENSE : Nat = 5;
  public let BASE_ATTACK_SPEED : Nat = 10000;  // 100% stored as 10000
  let BASE_CRIT_CHANCE : Nat = 500;     // 5% stored as 500

  // Constants for level scaling
  let HP_PER_LEVEL : Nat = 20;
  let MP_PER_LEVEL : Nat = 10;
  let PHYSICAL_ATTACK_PER_LEVEL : Nat = 2;
  let PHYSICAL_DEFENSE_PER_LEVEL : Nat = 1;
  let MAGIC_ATTACK_PER_LEVEL : Nat = 2;
  let MAGIC_DEFENSE_PER_LEVEL : Nat = 1;

  // Constants for attribute scaling
  let HP_PER_CONSTITUTION : Nat = 10;
  let MP_PER_INTELLIGENCE : Nat = 5;
  let MP_PER_WISDOM : Nat = 3;
  let ATTACK_PER_STRENGTH : Nat = 2;
  let SPEED_PER_DEXTERITY : Nat = 50;  // 0.5% per point stored as 50
  let DODGE_PER_DEXTERITY : Nat = 50;  // 0.5% per point
  let CRIT_PER_DEXTERITY : Nat = 20;   // 0.2% per point

  // Constants for combat timings
  public let GLOBAL_COOLDOWN_NS : Int = 2_500_000_000;  // 2.5 seconds
  public let BASIC_ATTACK_COOLDOWN_NS : Int = 5_000_000_000;  // 5 seconds
  public let COMBAT_DURATION_NS : Int = 20_000_000_000;  // 20 seconds

  // Attack speed constants
  public let MAX_ATTACK_SPEED_REDUCTION : Nat = 5000;  // Maximum 50% reduction

  // Calculate cooldown reduction based on attack speed
  public func calculateReducedCooldown(baseCooldown: Int, attackSpeed: Nat) : Int {
    let reduction = if (attackSpeed <= BASE_ATTACK_SPEED) {
      0  // No reduction if speed is 100% or less
    } else {
      let speedBonus = Nat.min(attackSpeed - BASE_ATTACK_SPEED, MAX_ATTACK_SPEED_REDUCTION);
      (baseCooldown * speedBonus) / BASE_ATTACK_SPEED
    };
    baseCooldown - reduction
  };

  // Create initial base stats for a new character
  private func createInitialBaseStats() : Types.BaseStats {
    {
      level = 1;
      baseHp = BASE_HP;
      baseMp = BASE_MP;
      basePhysicalAttack = BASE_PHYSICAL_ATTACK;
      basePhysicalDefense = BASE_PHYSICAL_DEFENSE;
      baseMagicAttack = BASE_MAGIC_ATTACK;
      baseMagicDefense = BASE_MAGIC_DEFENSE;
      baseAttackSpeed = BASE_ATTACK_SPEED;
      strength = 1;
      dexterity = 1;
      constitution = 1;
      intelligence = 1;
      wisdom = 1;
      maxHp = BASE_HP + HP_PER_CONSTITUTION;
      maxMp = BASE_MP + MP_PER_INTELLIGENCE + MP_PER_WISDOM;
      physicalAttack = BASE_PHYSICAL_ATTACK + ATTACK_PER_STRENGTH;
      physicalDefense = BASE_PHYSICAL_DEFENSE + 1;
      magicAttack = BASE_MAGIC_ATTACK + 2;
      magicDefense = BASE_MAGIC_DEFENSE + 2;
      attackSpeed = BASE_ATTACK_SPEED + SPEED_PER_DEXTERITY;
      dodgeChance = DODGE_PER_DEXTERITY;
      criticalChance = BASE_CRIT_CHANCE + CRIT_PER_DEXTERITY;
    }
  };

  // Message log functions
  private func ensureMessageLog(state: MudState, p: Principal) {
    switch (state.messageLogs.get(p)) {
      case null {
        state.messageLogs.put(p, BufferUtils.createCircularBuffer());
      };
      case (?_) {};
    };
  };

  public func addMessageToLog(state: MudState, p: Principal, content: Text) {
    //Debug.print("Adding message for principal: " # Principal.toText(p));
    //Debug.print("Message content: " # content);
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
        //Debug.print("Message added with ID: " # Nat.toText(msg.id));
      };
    };
  };

  // Send a system message to a specific player
  public func sendSystemMessage(state: MudState, targetPrincipal: Principal, content: Text) : Result.Result<(), Text> {
    switch (state.players.get(targetPrincipal)) {
      case null { #err("Target player not found") };
      case (?_) {
        addMessageToLog(state, targetPrincipal, content);
        #ok(())
      };
    }
  };

  // Centralized broadcast helper
  private func broadcastToPlayers(state: MudState, players: [(Principal, Text)], content: Text, excludePrincipal: ?Principal) {
    for ((principal, _) in players.vals()) {
      switch (excludePrincipal) {
        case (?excluded) { 
          if (principal != excluded) {
            switch (State.getPlayerStatus(state, principal)) {
              case (#Offline) { /* Skip offline players */ };
              case _ { addMessageToLog(state, principal, content) };
            };
          };
        };
        case null {
          switch (State.getPlayerStatus(state, principal)) {
            case (#Offline) { /* Skip offline players */ };
            case _ { addMessageToLog(state, principal, content) };
          };
        };
      };
    };
  };

  // Helper to get all players in a room
  private func getAllPlayersInRoom(state: MudState, roomId: RoomId) : [(Principal, Text)] {
    let players = Buffer.Buffer<(Principal, Text)>(0);
    for ((principal, location) in state.playerLocations.entries()) {
      if (location == roomId) {
        switch (state.players.get(principal)) {
          case (?name) { players.add((principal, name)) };
          case null {}; // Skip players without names
        };
      };
    };
    Buffer.toArray(players)
  };

  public func broadcastToRoom(state: MudState, roomId: RoomId, content: Text) {
    let players = getAllPlayersInRoom(state, roomId);
    broadcastToPlayers(state, players, content, null);
  };

  public func broadcastToRoomExcept(state: MudState, roomId: RoomId, excludePrincipal: Principal, content: Text) {
    let players = getAllPlayersInRoom(state, roomId);
    broadcastToPlayers(state, players, content, ?excludePrincipal);
  };

  public func getMessages(state: MudState, caller: Principal, afterId: ?MessageId) : [LogMessage] {
    Debug.print("Getting messages for principal: " # Principal.toText(caller));
    
    switch (state.messageLogs.get(caller)) {
      case null { 
        //Debug.print("No message log found for principal");
        [] 
      };
      case (?cb) {
        //Debug.print("Found message log with size: " # Nat.toText(cb.size));
        
        // Short circuit if we know there are no newer messages
        switch (afterId) {
          case (?requestedId) {
            if (requestedId >= cb.highestId) {
              //Debug.print("No new messages after ID: " # Nat.toText(requestedId));
              return [];
            };
          };
          case null {};
        };

        switch (afterId) {
          case null {
            // Return last 100 messages
            let messages = BufferUtils.getLastNFromCircularBuffer(cb, 100);
            //Debug.print("Returning messages count: " # Nat.toText(messages.size()));
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
            //Debug.print("Returning messages after ID: " # Nat.toText(id));
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

    // Update activity timestamp
    State.updatePlayerActivity(state, caller);

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

        // Update activity timestamp
        State.updatePlayerActivity(state, caller);

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
          return #err("You don't have permission to modify this room");
        };

        // Update activity timestamp
        State.updatePlayerActivity(state, caller);

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
          return #err("You don't have permission to modify this room");
        };

        // Update activity timestamp
        State.updatePlayerActivity(state, caller);

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

        // Update activity timestamp
        State.updatePlayerActivity(state, caller);

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

        // Update activity timestamp
        State.updatePlayerActivity(state, caller);

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
  public func registerPlayerName(state: MudState, caller: Principal, name: Text) : Result.Result<Text, Text> {
    // Check if name is empty or too long
    if (Text.size(name) == 0) {
      return #err("Name cannot be empty");
    };
    if (Text.size(name) > 20) {
      return #err("Name cannot be longer than 20 characters");
    };

    // Check if name contains spaces
    for (char in name.chars()) {
      if (char == ' ') {
        return #err("Player names cannot contain spaces");
      };
    };

    // Check if name is already taken
    switch (State.findPrincipalByName(state, name)) {
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
            
            // Create character stats
            switch (createCharacter(state, caller)) {
              case (#err(e)) { return #err(e) };
              case (#ok(_)) {
                // Add welcome message to player's log
                addMessageToLog(state, caller, "Welcome to the game, " # name # "! Your character has been created with starting stats.");
                
                // Place player in starting room (room 0) if it exists
                switch (state.rooms.get(starting_room)) {
                  case (?room) {
                    state.playerLocations.put(caller, starting_room);
                    
                    // Broadcast entry message to non-offline players
                    let players = getAllPlayersInRoom(state, starting_room);
                    broadcastToPlayers(state, players, name # " has entered the game", ?caller);
                    
                    // Show other players in the room
                    showPlayersInRoom(state, starting_room, caller);
                    
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

  // Helper function to format a list of players with AFK status
  private func formatPlayerList(state: MudState, players: [(Principal, Text)]) : Text {
    let formattedNames = Array.map<(Principal, Text), Text>(players, func(entry) {
      let (principal, name) = entry;
      switch (State.getPlayerStatus(state, principal)) {
        case (#Online) { name };
        case (#Afk) { name # " (AFK)" };
        case (#Offline) { name # " (Offline)" }; // Should never happen as we filter these out
      };
    });

    switch (formattedNames.size()) {
      case 0 { "" };
      case 1 { formattedNames[0] # " is here" };
      case 2 { formattedNames[0] # " and " # formattedNames[1] # " are here" };
      case _ {
        let last = formattedNames.size() - 1;
        var result = "";
        var i = 0;
        while (i < last - 1) {
          result := result # formattedNames[i] # ", ";
          i += 1;
        };
        result # formattedNames[last - 1] # " and " # formattedNames[last] # " are here"
      };
    };
  };

  // Helper function to get list of players in a room except one player
  private func getPlayersInRoomExcept(state: MudState, roomId: RoomId, excludePrincipal: Principal) : Result.Result<[(Principal, Text)], Text> {
    switch (state.rooms.get(roomId)) {
      case null { #err("Room not found") };
      case (?_) {
        let allPlayers = getAllPlayersInRoom(state, roomId);
        let players = Buffer.Buffer<(Principal, Text)>(0);
        for ((principal, name) in allPlayers.vals()) {
          if (principal != excludePrincipal) {
            switch (State.getPlayerStatus(state, principal)) {
              case (#Offline) { /* Skip offline players */ };
              case _ { players.add((principal, name)) };
            };
          };
        };
        #ok(Buffer.toArray(players))
      };
    }
  };

  // Helper to show players in a room to a specific player
  private func showPlayersInRoom(state: MudState, roomId: RoomId, observer: Principal) {
    switch (getPlayersInRoomExcept(state, roomId, observer)) {
      case (#err(_)) { /* Ignore error */ };
      case (#ok(otherPlayers)) {
        if (otherPlayers.size() > 0) {
          addMessageToLog(state, observer, formatPlayerList(state, otherPlayers));
        } else {
          addMessageToLog(state, observer, "You are alone here");
        };
      };
    };
  };

  // Helper for handling movement messages
  private func handleMovementMessages(
    state: MudState,
    caller: Principal,
    playerName: Text,
    fromRoom: Room,
    toRoom: Room,
    exitName: Text
  ) {
    // Departure messages
    broadcastToRoomExcept(state, fromRoom.id, caller, playerName # " leaves through " # exitName);
    addMessageToLog(state, caller, "You leave through " # exitName);

    // Arrival messages
    broadcastToRoomExcept(state, toRoom.id, caller, playerName # " arrives from " # fromRoom.name);
    addMessageToLog(state, caller, "You arrive in " # toRoom.name);

    // Show other players in new room
    showPlayersInRoom(state, toRoom.id, caller);
  };

  public func useExit(state: MudState, caller: Principal, exitId: Text) : Result.Result<Room, Text> {
    // Check if player is registered
    switch (state.players.get(caller)) {
      case null { return #err("You need to register a name first") };
      case (?playerName) {
        // Check if player can move
        switch (State.canPerformAction(state, caller, #Movement)) {
          case (#err(e)) { return #err(e) };
          case (#ok(_)) {
            // Update player's activity timestamp
            State.updatePlayerActivity(state, caller);

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
                        // Handle all movement-related messages
                        handleMovementMessages(state, caller, playerName, currentRoom, targetRoom, exit.name);
                        
                        // Move player
                        state.playerLocations.put(caller, exit.targetRoomId);
                        
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
    };
  };

  public func getPlayersInRoom(state: MudState, roomId: RoomId) : Result.Result<[(Principal, Text)], Text> {
    switch (state.rooms.get(roomId)) {
      case null { #err("Room not found") };
      case (?_) {
        let allPlayers = getAllPlayersInRoom(state, roomId);
        let players = Buffer.Buffer<(Principal, Text)>(0);
        for ((principal, name) in allPlayers.vals()) {
          switch (State.getPlayerStatus(state, principal)) {
            case (#Offline) { /* Skip offline players */ };
            case _ { players.add((principal, name)) };
          };
        };
        #ok(Buffer.toArray(players))
      };
    }
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
        // Check if player can communicate
        switch (State.canPerformAction(state, caller, #Communication)) {
          case (#err(e)) { return #err(e) };
          case (#ok(_)) {
            switch (state.playerLocations.get(caller)) {
              case null { #err("You're not in any room") };
              case (?roomId) {
                // Update sender's activity timestamp
                State.updatePlayerActivity(state, caller);

                // Get death status for message prefix
                let prefix = switch (state.playerDynamicStats.get(caller)) {
                  case (?stats) { if (stats.isDead) { "*GHOST* " } else { "" } };
                  case null { "" };
                };

                // Send personalized message to the speaker
                addMessageToLog(state, caller, "You say: " # message);
                
                // Broadcast to others in room with ghost prefix if dead
                let players = getAllPlayersInRoom(state, roomId);
                broadcastToPlayers(state, players, prefix # playerName # " says: " # message, ?caller);
                #ok(())
              };
            };
          };
        };
      };
    };
  };

  public func whisper(state: MudState, caller: Principal, targetName: Text, message: Text) : Result.Result<(), Text> {
    switch (state.players.get(caller)) {
      case null { #err("You need to register a name first") };
      case (?senderName) {
        // Check if player can communicate
        switch (State.canPerformAction(state, caller, #Communication)) {
          case (#err(e)) { return #err(e) };
          case (#ok(_)) {
            // Find target principal by name
            switch (State.findPrincipalByName(state, targetName)) {
              case null { #err("Player not found: " # targetName) };
              case (?targetPrincipal) {
                // Update sender's activity timestamp
                State.updatePlayerActivity(state, caller);

                // Get death status for message prefix
                let prefix = switch (state.playerDynamicStats.get(caller)) {
                  case (?stats) { if (stats.isDead) { "*GHOST* " } else { "" } };
                  case null { "" };
                };

                // Deliver message to target with ghost prefix if dead
                addMessageToLog(state, targetPrincipal, prefix # senderName # " whispers: " # message);
                addMessageToLog(state, caller, "You whisper to " # targetName # ": " # message);

                // Check target's status and send auto-reply if needed
                switch (State.getPlayerStatus(state, targetPrincipal)) {
                  case (#Online) { /* No auto-reply needed */ };
                  case (#Afk) { 
                    addMessageToLog(state, caller, targetName # " is currently AFK and will see your message later");
                  };
                  case (#Offline) {
                    addMessageToLog(state, caller, targetName # " is currently offline and will see your message later");
                  };
                };
                #ok(())
              };
            };
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

  // Character creation and stats functions
  public func createCharacter(state: MudState, caller: Principal) : Result.Result<(), Text> {
    // Update activity timestamp
    State.updatePlayerActivity(state, caller);

    // Check if player already has stats
    switch (state.playerBaseStats.get(caller)) {
      case (?_) { #err("You already have a character") };
      case null {
        let baseStats = createInitialBaseStats();
        
        let dynamicStats : Types.DynamicStats = {
          hp = baseStats.maxHp;
          mp = baseStats.maxMp;
          xp = 0;
          isDead = false;
          deathTime = null;
          xpPenaltyEndTime = null;
        };

        state.playerBaseStats.put(caller, baseStats);
        state.playerDynamicStats.put(caller, dynamicStats);
        #ok(())
      };
    }
  };

  public func getPlayerStats(state: MudState, caller: Principal) : Result.Result<Types.PlayerStats, Text> {
    // Update activity timestamp
    State.updatePlayerActivity(state, caller);

    switch (state.playerBaseStats.get(caller)) {
      case null { #err("No character found") };
      case (?baseStats) {
        switch (state.playerDynamicStats.get(caller)) {
          case null { #err("No character found") };
          case (?dynamicStats) {
            let nextLevelXp = State.xpForNextLevel(baseStats.level);
            let stats : Types.PlayerStats = {
              base = baseStats;
              dynamic = dynamicStats;
              xpForNextLevel = nextLevelXp;
              xpNeeded = nextLevelXp - dynamicStats.xp;
              // Convert percentages to 4 decimal places (10000 = 1.0000)
              attackSpeedPercent = baseStats.attackSpeed * 10000 / 100;
              baseAttackSpeedPercent = baseStats.baseAttackSpeed * 10000 / 100;
              dodgeChancePercent = baseStats.dodgeChance * 10000 / 100;
              criticalChancePercent = baseStats.criticalChance * 10000 / 100;
            };
            #ok(stats)
          };
        };
      };
    }
  };

  // Check if a player has leveled up and handle stat increases
  public func checkAndHandleLevelUp(state: MudState, principal: Principal) : Bool {
    switch (state.playerBaseStats.get(principal), state.playerDynamicStats.get(principal)) {
      case (?baseStats, ?dynamicStats) {
        // Check if XP is enough for next level
        let nextLevelXp = State.xpForNextLevel(baseStats.level);
        if (dynamicStats.xp >= nextLevelXp) {
          // Calculate new stats
          let newLevel = baseStats.level + 1;
          let newBaseHp = baseStats.baseHp + 10;  // +10 HP per level
          let newBaseMp = baseStats.baseMp + 5;   // +5 MP per level
          let newBasePhysicalAttack = baseStats.basePhysicalAttack + 2;  // +2 attack per level
          let newBasePhysicalDefense = baseStats.basePhysicalDefense + 2; // +2 defense per level
          let newBaseMagicAttack = baseStats.baseMagicAttack + 2;
          let newBaseMagicDefense = baseStats.baseMagicDefense + 2;

          // Create updated base stats
          let updatedBaseStats : Types.BaseStats = {
            level = newLevel;
            // Update base values
            baseHp = newBaseHp;
            baseMp = newBaseMp;
            basePhysicalAttack = newBasePhysicalAttack;
            basePhysicalDefense = newBasePhysicalDefense;
            baseMagicAttack = newBaseMagicAttack;
            baseMagicDefense = newBaseMagicDefense;
            baseAttackSpeed = baseStats.baseAttackSpeed;
            // Keep primary attributes unchanged
            strength = baseStats.strength;
            dexterity = baseStats.dexterity;
            constitution = baseStats.constitution;
            intelligence = baseStats.intelligence;
            wisdom = baseStats.wisdom;
            // Recalculate derived stats
            maxHp = newBaseHp + (baseStats.constitution * 5);
            maxMp = newBaseMp + (baseStats.wisdom * 3);
            physicalAttack = newBasePhysicalAttack + (baseStats.strength * 2);
            physicalDefense = newBasePhysicalDefense + (baseStats.constitution * 2);
            magicAttack = newBaseMagicAttack + (baseStats.intelligence * 2);
            magicDefense = newBaseMagicDefense + (baseStats.wisdom * 2);
            attackSpeed = baseStats.baseAttackSpeed + (baseStats.dexterity * 20);
            dodgeChance = baseStats.dexterity * 20;
            criticalChance = baseStats.dexterity * 20;
          };

          // Update base stats
          state.playerBaseStats.put(principal, updatedBaseStats);

          // Heal to full on level up
          let updatedDynamicStats : Types.DynamicStats = {
            hp = updatedBaseStats.maxHp;
            mp = updatedBaseStats.maxMp;
            xp = dynamicStats.xp;
            isDead = dynamicStats.isDead;
            deathTime = dynamicStats.deathTime;
            xpPenaltyEndTime = dynamicStats.xpPenaltyEndTime;
          };
          state.playerDynamicStats.put(principal, updatedDynamicStats);

          // Broadcast level up message
          switch (state.players.get(principal), state.playerLocations.get(principal)) {
            case (?name, ?roomId) {
              broadcastToRoom(state, roomId, "*** " # name # " has reached level " # Nat.toText(newLevel) # "! ***");
            };
            case _ {};
          };

          true
        } else {
          false
        };
      };
      case _ { false };
    }
  };

  // Get available classes for character creation
  public func getAvailableClasses(state: MudState, caller: Principal) : Result.Result<[Types.Class], Text> {
    let isRealmOwner = State.isRealmOwner(state, caller);
    
    // Convert classes HashMap to array, excluding God class
    let regularClasses = Buffer.Buffer<Types.Class>(state.classes.size());
    for ((_, classData) in state.classes.entries()) {
      if (not classData.isAdminClass) {
        regularClasses.add(classData);
      };
    };

    // If no regular classes exist and caller is realm owner, add God class
    if (regularClasses.size() == 0 and isRealmOwner) {
      switch (state.adminClass) {
        case (?godClass) { 
          regularClasses.add(godClass);
        };
        case null { };
      };
    };

    #ok(Buffer.toArray(regularClasses))
  };

  // Create character with specified class
  public func createCharacterWithClass(state: MudState, caller: Principal, className: Text) : Result.Result<(), Text> {
    // Check if player already has stats
    switch (state.playerBaseStats.get(caller)) {
      case (?_) { return #err("You already have a character") };
      case null { };
    };

    // Get the class
    let selectedClass : ?Types.Class = 
      if (className == "God") {
        // Special handling for God class
        if (State.isRealmOwner(state, caller) and state.classes.size() == 0) {
          state.adminClass;
        } else {
          null;
        };
      } else {
        state.classes.get(className);
      };

    switch (selectedClass) {
      case null { 
        if (className == "God") {
          if (not State.isRealmOwner(state, caller)) {
            #err("Only realm owners can use the God class")
          } else if (state.classes.size() > 0) {
            #err("God class is only available when no other classes exist")
          } else {
            #err("God class not found")
          };
        } else {
          #err("Invalid class selected")
        };
      };
      case (?classData) {
        // Initialize stats from class template
        let baseStats = classData.baseStats;
        let dynamicStats : Types.DynamicStats = {
          hp = baseStats.maxHp;
          mp = baseStats.maxMp;
          xp = 0;
          isDead = false;
          deathTime = null;
          xpPenaltyEndTime = null;
        };

        state.playerBaseStats.put(caller, baseStats);
        state.playerDynamicStats.put(caller, dynamicStats);
        #ok(())
      };
    };
  };

  // Create a new class with default values
  public func createNewClass(state: MudState, caller: Principal, name: Text, description: Text) : Result.Result<(), Text> {
    // Check if caller is a realm owner
    if (not State.isRealmOwner(state, caller)) {
      return #err("Only realm owners can create classes");
    };

    // Check if class name already exists
    switch (state.classes.get(name)) {
      case (?_) { return #err("A class with this name already exists") };
      case null { };
    };

    // Create the class
    let newClass = Class.createClass(name, description);
    state.classes.put(name, newClass);

    // If this is the first regular class, disable God class
    if (state.classes.size() == 1) {
      state.adminClass := null;
    };

    #ok(())
  };

  // Helper function to update description
  private func updateClassDescription(classData: Types.Class, value: Text) : Types.Class {
    {
      name = classData.name;
      description = value;
      isAdminClass = classData.isAdminClass;
      baseStats = classData.baseStats;
      growthRates = classData.growthRates;
    }
  };

  // Helper function to update base HP
  private func updateClassBaseHp(classData: Types.Class, hp: Nat) : Result.Result<Types.Class, Text> {
    if (hp < 1 or hp > 10000) {
      #err("HP must be between 1 and 10000");
    } else {
      let newBaseStats = { classData.baseStats with 
        baseHp = hp;
        maxHp = hp + (classData.baseStats.constitution * HP_PER_CONSTITUTION);
      };
      #ok({
        name = classData.name;
        description = classData.description;
        isAdminClass = classData.isAdminClass;
        baseStats = newBaseStats;
        growthRates = classData.growthRates;
      })
    }
  };

  // Helper function to update base MP
  private func updateClassBaseMp(classData: Types.Class, mp: Nat) : Result.Result<Types.Class, Text> {
    if (mp < 1 or mp > 10000) {
      #err("MP must be between 1 and 10000");
    } else {
      let newBaseStats = { classData.baseStats with 
        baseMp = mp;
        maxMp = mp + (classData.baseStats.wisdom * MP_PER_WISDOM);
      };
      #ok({
        name = classData.name;
        description = classData.description;
        isAdminClass = classData.isAdminClass;
        baseStats = newBaseStats;
        growthRates = classData.growthRates;
      })
    }
  };

  // Update a class attribute
  public func updateClass(
    state: MudState, 
    caller: Principal, 
    className: Text, 
    attribute: Text, 
    value: Text
  ) : Result.Result<(), Text> {
    // Check if caller is a realm owner
    if (not State.isRealmOwner(state, caller)) {
      return #err("Only realm owners can update classes");
    };

    // Get the class data
    let existingData = state.classes.get(className);
    switch (existingData) {
      case null { return #err("Class not found") };
      case (?data) {
        if (data.isAdminClass) {
          return #err("Cannot modify the God class");
        };

        // Handle each attribute type
        let updated = if (Text.equal(attribute, "description")) {
          updateClassDescription(data, value);
        } else if (Text.equal(attribute, "baseHp")) {
          switch (Nat.fromText(value)) {
            case null { return #err("Invalid HP value") };
            case (?hp) {
              if (hp < 1 or hp > 10000) {
                return #err("HP must be between 1 and 10000");
              };
              let newBaseStats = { data.baseStats with 
                baseHp = hp;
                maxHp = hp + (data.baseStats.constitution * HP_PER_CONSTITUTION);
              };
              {
                name = data.name;
                description = data.description;
                isAdminClass = data.isAdminClass;
                baseStats = newBaseStats;
                growthRates = data.growthRates;
              };
            };
          };
        } else if (Text.equal(attribute, "baseMp")) {
          switch (Nat.fromText(value)) {
            case null { return #err("Invalid MP value") };
            case (?mp) {
              if (mp < 1 or mp > 10000) {
                return #err("MP must be between 1 and 10000");
              };
              let newBaseStats = { data.baseStats with 
                baseMp = mp;
                maxMp = mp + (data.baseStats.wisdom * MP_PER_WISDOM);
              };
              {
                name = data.name;
                description = data.description;
                isAdminClass = data.isAdminClass;
                baseStats = newBaseStats;
                growthRates = data.growthRates;
              };
            };
          };
        } else {
          return #err("Unknown attribute: " # attribute);
        };

        state.classes.put(className, updated);
        #ok(());
      };
    };
  };

  // List all available classes
  public func listClasses(state: MudState, caller: Principal) : Result.Result<[Types.Class], Text> {
    let classes = Buffer.Buffer<Types.Class>(state.classes.size());
    for ((_, classData) in state.classes.entries()) {
      if (not classData.isAdminClass) {
        classes.add(classData);
      };
    };
    #ok(Buffer.toArray(classes))
  };

  // Show detailed information about a specific class
  public func showClass(state: MudState, className: Text) : Result.Result<Types.Class, Text> {
    switch (state.classes.get(className)) {
      case null { #err("Class not found") };
      case (?classData) {
        if (classData.isAdminClass) {
          return #err("Class not found");  // Hide God class
        };
        #ok(classData)
      };
    }
  };
} 