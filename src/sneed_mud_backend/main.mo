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
import Time "mo:base/Time";
import Types "./Types";

actor {
  type Room = Types.Room;
  type RoomId = Types.RoomId;
  type Exit = Types.Exit;
  type LogMessage = Types.LogMessage;
  type MessageId = Types.MessageId;
  type CircularBuffer<T> = Types.CircularBuffer<T>;

  let MESSAGE_BUFFER_SIZE = 1000;

  // Helper functions for circular buffer
  private func createCircularBuffer<T>() : CircularBuffer<T> {
    {
      var buffer = Array.init<?T>(MESSAGE_BUFFER_SIZE, null);
      var start = 0;
      var size = 0;
      var highestId = null;
    }
  };

  private func addToCircularBuffer<T>(cb: CircularBuffer<T>, value: T) {
    let index = (cb.start + cb.size) % MESSAGE_BUFFER_SIZE;
    cb.buffer[index] := ?value;
    
    if (cb.size < MESSAGE_BUFFER_SIZE) {
      cb.size += 1;
    } else {
      cb.start := (cb.start + 1) % MESSAGE_BUFFER_SIZE;
    };
  };

  private func getFromCircularBuffer<T>(cb: CircularBuffer<T>, startIndex: Nat, count: Nat) : [T] {
    let result = Buffer.Buffer<T>(count);
    var i = 0;
    while (i < count and i < cb.size) {
      let index = (cb.start + i) % MESSAGE_BUFFER_SIZE;
      switch (cb.buffer[index]) {
        case (?value) { result.add(value); };
        case null {};
      };
      i += 1;
    };
    Buffer.toArray(result)
  };

  private func getLastNFromCircularBuffer<T>(cb: CircularBuffer<T>, n: Nat) : [T] {
    let count = if (cb.size < n) { cb.size } else { n };
    let startIndex = cb.size - count;
    getFromCircularBuffer(cb, startIndex, count)
  };

  // Stable storage
  private stable var playerEntries : [(Principal, Text)] = [];
  private stable var roomEntries : [(RoomId, Room)] = [];
  private stable var playerLocationEntries : [(Principal, RoomId)] = [];
  private stable var messageLogEntries : [(Principal, [LogMessage])] = [];

  private stable var nextRoomId : Nat = 0;
  private stable var nextMessageId : MessageId = 0;

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
  private var messageLogs = HashMap.HashMap<Principal, CircularBuffer<LogMessage>>(100, Principal.equal, Principal.hash);

  // Initialize message logs from stable storage
  for ((principal, messages) in messageLogEntries.vals()) {
    let cb = createCircularBuffer<LogMessage>();
    for (msg in messages.vals()) {
      addToCircularBuffer(cb, msg);
    };
    messageLogs.put(principal, cb);
  };

  let starting_room : RoomId = 0;

  // System upgrade hooks
  system func preupgrade() {
    playerEntries := Iter.toArray(players.entries());
    roomEntries := Iter.toArray(rooms.entries());
    playerLocationEntries := Iter.toArray(playerLocations.entries());
    messageLogEntries := Array.map<(Principal, CircularBuffer<LogMessage>), (Principal, [LogMessage])>(
      Iter.toArray(messageLogs.entries()),
      func ((p, cb) : (Principal, CircularBuffer<LogMessage>)) : (Principal, [LogMessage]) {
        (p, getFromCircularBuffer(cb, 0, cb.size))
      }
    );
  };

  system func postupgrade() {
    playerEntries := [];
    roomEntries := [];
    playerLocationEntries := [];
    messageLogEntries := [];
  };

  // Message buffer specific functions
  private type MessageBuffer = {
    var buffer: [var ?LogMessage];
    var start: Nat;
    var size: Nat;
    var highestId: ?MessageId;
  };

  private func createMessageBuffer() : MessageBuffer {
    {
      var buffer = Array.init<?LogMessage>(MESSAGE_BUFFER_SIZE, null);
      var start = 0;
      var size = 0;
      var highestId = null;
    }
  };

  private func addMessageToBuffer(mb: MessageBuffer, msg: LogMessage) {
    let index = (mb.start + mb.size) % MESSAGE_BUFFER_SIZE;
    mb.buffer[index] := ?msg;
    mb.highestId := ?msg.id;
    
    if (mb.size < MESSAGE_BUFFER_SIZE) {
      mb.size += 1;
    } else {
      mb.start := (mb.start + 1) % MESSAGE_BUFFER_SIZE;
    };
  };

  private func getMessagesFromBuffer(mb: MessageBuffer, startIndex: Nat, count: Nat) : [LogMessage] {
    let result = Buffer.Buffer<LogMessage>(count);
    var i = 0;
    while (i < count and i < mb.size) {
      let index = (mb.start + i) % MESSAGE_BUFFER_SIZE;
      switch (mb.buffer[index]) {
        case (?value) { result.add(value); };
        case null {};
      };
      i += 1;
    };
    Buffer.toArray(result)
  };

  private func getLastNMessagesFromBuffer(mb: MessageBuffer, n: Nat) : [LogMessage] {
    let count = if (mb.size < n) { mb.size } else { n };
    let startIndex = mb.size - count;
    getMessagesFromBuffer(mb, startIndex, count)
  };

  // Message log functions
  private func ensureMessageLog(p: Principal) {
    switch (messageLogs.get(p)) {
      case null {
        messageLogs.put(p, createMessageBuffer());
      };
      case (?_) {};
    };
  };

  private func addMessageToLog(p: Principal, content: Text) {
    Debug.print("Adding message for principal: " # Principal.toText(p));
    Debug.print("Message content: " # content);
    ensureMessageLog(p);
    switch (messageLogs.get(p)) {
      case null { /* impossible due to ensureMessageLog */ };
      case (?cb) {
        let msg : LogMessage = {
          id = nextMessageId;
          timestamp = Time.now();
          content = content;
        };
        nextMessageId += 1;
        addMessageToBuffer(cb, msg);
        Debug.print("Message added with ID: " # Nat.toText(msg.id));
      };
    };
  };

  private func broadcastToRoom(roomId: RoomId, content: Text) {
    for ((principal, location) in playerLocations.entries()) {
      if (location == roomId) {
        addMessageToLog(principal, content);
      };
    };
  };

  private func getMessagesInternal(caller: Principal, afterId: ?MessageId) : [LogMessage] {
    Debug.print("Getting messages for principal: " # Principal.toText(caller));
    
    switch (messageLogs.get(caller)) {
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
            let messages = getLastNMessagesFromBuffer(cb, 100);
            Debug.print("Returning messages count: " # Nat.toText(messages.size()));
            messages
          };
          case (?id) {
            // Return messages strictly after the given id
            let messages = getMessagesFromBuffer(cb, 0, cb.size);
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

  public query(msg) func getMessages(afterId: ?MessageId) : async [LogMessage] {
    getMessagesInternal(msg.caller, afterId)
  };

  public query func test_getMessages(principal : Principal, afterId: ?MessageId) : async [LogMessage] {
    getMessagesInternal(principal, afterId);
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
            
            // Add welcome message to player's log
            addMessageToLog(caller, "Welcome to the game, " # name # "!");
            
            // Place player in starting room (room 0) if it exists
            switch (rooms.get(starting_room)) {
              case (?room) {
                playerLocations.put(caller, starting_room);
                broadcastToRoom(starting_room, name # " has entered the game");
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
      case (?playerName) {
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
                    // Broadcast departure to current room
                    broadcastToRoom(currentRoom.id, playerName # " leaves through " # exit.name);
                    
                    // Move player
                    playerLocations.put(caller, exit.targetRoomId);
                    
                    // Broadcast arrival to new room
                    broadcastToRoom(targetRoom.id, playerName # " arrives from " # currentRoom.name);
                    
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

  public shared(msg) func clearPlayer(principal: Principal) : async () {
    // Remove from players HashMap and usedNames
    switch (players.get(principal)) {
      case (?name) {
        players.delete(principal);
        usedNames.delete(name);
      };
      case null {};
    };

    // Remove from playerLocations
    playerLocations.delete(principal);

    // Remove from messageLogs
    messageLogs.delete(principal);
  };
};
