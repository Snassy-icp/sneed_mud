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
import Time "mo:base/Time";
import Result "mo:base/Result";
import Debug "mo:base/Debug";

module {
  type ActionType = Types.ActionType;

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
    var stableRegisteredTokens: Types.StableTokenRegistrations;
    var stableMetadataCache: [(Principal, Types.TokenMetadata)];
    var stableCharacterClasses: [(Text, Types.CharacterClass)];
    var stableAdminCharacterClass: ?Types.CharacterClass;
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
    registeredTokens: HashMap.HashMap<Principal, [Principal]>;
    metadataCache: HashMap.HashMap<Principal, Types.TokenMetadata>;
    playerLastActivity: HashMap.HashMap<Principal, Int>;
    var afkConfig: Types.AfkConfig;
    playerCombatStates: HashMap.HashMap<Principal, Types.CombatState>;
    characterClasses: HashMap.HashMap<Text, Types.CharacterClass>;
    var adminCharacterClass: ?Types.CharacterClass;
    playerStatus: HashMap.HashMap<Principal, Types.PlayerStatus>;
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
      var stableRegisteredTokens = [] : Types.StableTokenRegistrations;
      var stableMetadataCache = [] : [(Principal, Types.TokenMetadata)];
      var stableCharacterClasses = [] : [(Text, Types.CharacterClass)];
      var stableAdminCharacterClass = null;
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
      10,
      Principal.equal,
      Principal.hash
    );

    let playerDynamicStats = HashMap.fromIter<Principal, Types.DynamicStats>(
      stable_state.stablePlayerDynamicStats.vals(),
      10,
      Principal.equal,
      Principal.hash
    );

    let registeredTokens = HashMap.HashMap<Principal, [Principal]>(10, Principal.equal, Principal.hash);
    for ((principal, tokens) in stable_state.stableRegisteredTokens.vals()) {
      let userTokens = Iter.toArray(tokens.vals());
      registeredTokens.put(principal, userTokens);
    };

    let metadataCache = HashMap.fromIter<Principal, Types.TokenMetadata>(
      stable_state.stableMetadataCache.vals(),
      10,
      Principal.equal,
      Principal.hash
    );

    let characterClasses = HashMap.fromIter<Text, Types.CharacterClass>(
      stable_state.stableCharacterClasses.vals(),
      10,
      Text.equal,
      Text.hash
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
      registeredTokens = registeredTokens;
      metadataCache = metadataCache;
      playerLastActivity = HashMap.HashMap<Principal, Int>(10, Principal.equal, Principal.hash);
      var afkConfig = {
        afk_timeout_ns = 20 * 60 * 1_000_000_000;  // 20 minutes for AFK
        offline_timeout_ns = 60 * 60 * 1_000_000_000;  // 60 minutes for offline
      };
      playerCombatStates = HashMap.HashMap<Principal, Types.CombatState>(10, Principal.equal, Principal.hash);
      characterClasses = characterClasses;
      var adminCharacterClass = stable_state.stableAdminCharacterClass;
      playerStatus = HashMap.HashMap<Principal, Types.PlayerStatus>(10, Principal.equal, Principal.hash);
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

    // Convert registered tokens to stable format
    let stableRegisteredTokens = Buffer.Buffer<(Principal, [Principal])>(0);
    for ((principal, tokens) in state.registeredTokens.entries()) {
      stableRegisteredTokens.add((principal, tokens));
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
      var stableRegisteredTokens = Buffer.toArray(stableRegisteredTokens);
      var stableMetadataCache = Iter.toArray(state.metadataCache.entries());
      var stableCharacterClasses = Iter.toArray(state.characterClasses.entries());
      var stableAdminCharacterClass = state.adminCharacterClass;
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
    // Formula: 100 * N^2 where N is the next level
    let nextLevel = currentLevel + 1;
    100 * nextLevel * nextLevel
  };

  // Helper function to calculate total XP needed to reach a level
  public func totalXpForLevel(level: Nat) : Nat {
    // Formula: 100 * (N * (N-1) / 2) from the spec
    if (level <= 1) { return 0 };
    100 * (level * (level - 1) / 2)
  };

  // Set player status explicitly
  public func setPlayerStatus(state: MudState, principal: Principal, status: Types.PlayerStatus) {
    state.playerStatus.put(principal, status);
  };

  // Get current status, considering both stored status and activity timestamps
  public func getPlayerStatus(state: MudState, principal: Principal) : Types.PlayerStatus {
    Debug.print("Checking status for " # Principal.toText(principal));
    let now = Time.now();
    Debug.print("Current time: " # Int.toText(now));

    switch (state.playerLastActivity.get(principal)) {
      case null { 
        Debug.print("No activity record - treating as offline");
        #Offline 
      };
      case (?lastActivity) {
        let elapsed = now - lastActivity;
        Debug.print("Last activity: " # Int.toText(lastActivity));
        Debug.print("Elapsed time: " # Int.toText(elapsed));
        Debug.print("Offline threshold: " # Int.toText(state.afkConfig.offline_timeout_ns));
        Debug.print("AFK threshold: " # Int.toText(state.afkConfig.afk_timeout_ns));
        
        if (elapsed >= state.afkConfig.offline_timeout_ns) { 
          Debug.print("Elapsed >= offline threshold - marking as offline");
          #Offline;
        } else if (elapsed >= state.afkConfig.afk_timeout_ns) {
          Debug.print("Elapsed >= AFK threshold - marking as AFK");
          #Afk;
        } else {
          Debug.print("Within active thresholds - checking stored status");
          switch (state.playerStatus.get(principal)) {
            case (?status) { 
              Debug.print("Using stored status: " # debug_show(status));
              status 
            };
            case null { 
              Debug.print("No stored status - defaulting to Online");
              #Online 
            };
          };
        };
      };
    };
  };

  // Helper function to broadcast a message to all players in a room, except specified principals
  public func broadcastToRoom(state: MudState, roomId: Types.RoomId, content: Text, except: [Principal]) {
    for ((principal, location) in state.playerLocations.entries()) {
      if (location == roomId) {
        // Skip if principal is in except list
        var shouldSkip = false;
        for (excluded in except.vals()) {
          if (principal == excluded) {
            shouldSkip := true;
          };
        };
        if (not shouldSkip) {
          switch (state.players.get(principal)) {
            case (?_) {
              switch (getPlayerStatus(state, principal)) {
                case (#Offline) { /* Skip offline players */ };
                case _ { 
                  switch (state.messageLogs.get(principal)) {
                    case null {
                      let cb = BufferUtils.createCircularBuffer();
                      state.messageLogs.put(principal, cb);
                      let msg : Types.LogMessage = {
                        id = state.stable_state.nextMessageId;
                        timestamp = Time.now();
                        content = content;
                      };
                      state.stable_state.nextMessageId += 1;
                      BufferUtils.addToCircularBuffer(cb, msg);
                    };
                    case (?cb) {
                      let msg : Types.LogMessage = {
                        id = state.stable_state.nextMessageId;
                        timestamp = Time.now();
                        content = content;
                      };
                      state.stable_state.nextMessageId += 1;
                      BufferUtils.addToCircularBuffer(cb, msg);
                    };
                  };
                };
              };
            };
            case null {}; // Skip players without names
          };
        };
      };
    };
  };

  // Update player activity and handle status changes
  public func updatePlayerActivity(state: MudState, principal: Principal) {
    let oldStatus = getPlayerStatus(state, principal);
    let now = Time.now();
    Debug.print("Updating activity for " # Principal.toText(principal));
    Debug.print("Time now: " # Int.toText(now));
    state.playerLastActivity.put(principal, now);
    
    // If player was offline and is now coming online, broadcast login message
    if (oldStatus == #Offline) {
      switch (state.players.get(principal), state.playerLocations.get(principal)) {
        case (?playerName, ?roomId) {
          broadcastToRoom(state, roomId, playerName # " has logged in", []);
        };
        case _ {};
      };
    };
    
    // Auto-return from AFK when there's activity
    switch (oldStatus) {
      case (#Afk) { 
        setPlayerStatus(state, principal, #Online);
      };
      case _ {};
    };
  };

  public func findPrincipalByName(state: MudState, name: Text) : ?Principal {
    state.usedNames.get(name)
  };

  // Check if a player can perform a specific action
  public func canPerformAction(state: MudState, caller: Principal, actionType: ActionType) : Result.Result<(), Text> {
    // First check if player exists
    switch (state.players.get(caller)) {
      case null { #err("You need to register a name first") };
      case (?playerName) {
        // Get player stats
        switch (state.playerDynamicStats.get(caller)) {
          case null { #err("No character found") };
          case (?stats) {
            // If player is dead, only allow certain actions
            if (stats.isDead) {
              switch (actionType) {
                case (#Communication) { #ok(()) };
                case (#Info) { #ok(()) };
                case (#Respawn) {
                  // Check respawn cooldown
                  switch (stats.deathTime) {
                    case null { #err("No death time recorded") };
                    case (?deathTime) {
                      let now = Time.now();
                      let timeSinceDeath = now - deathTime;
                      if (timeSinceDeath < 60_000_000_000) { // 60 seconds in nanoseconds
                        #err("You must wait " # Int.toText((60_000_000_000 - timeSinceDeath) / 1_000_000_000) # " seconds to respawn")
                      } else {
                        #ok(())
                      }
                    };
                  }
                };
                case _ { #err("You cannot do that while dead") };
              }
            } else {
              // Living players can do anything
              #ok(())
            }
          };
        };
      };
    }
  };
} 