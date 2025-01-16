import Principal "mo:base/Principal";
import HashMap "mo:base/HashMap";
import Text "mo:base/Text";
import Iter "mo:base/Iter";
import Result "mo:base/Result";

actor {
  // Stable storage for player data
  private stable var playerEntries : [(Principal, Text)] = [];
  
  // Runtime HashMap for player data (Principal -> Name)
  private var players = HashMap.HashMap<Principal, Text>(0, Principal.equal, Principal.hash);
  
  // Runtime HashMap for name uniqueness check (Name -> Principal)
  private var usedNames = HashMap.HashMap<Text, Principal>(0, Text.equal, Text.hash);

  // System upgrade hooks
  system func preupgrade() {
    playerEntries := Iter.toArray(players.entries());
  };

  system func postupgrade() {
    let initialCapacity = playerEntries.size();
    players := HashMap.HashMap<Principal, Text>(initialCapacity, Principal.equal, Principal.hash);
    usedNames := HashMap.HashMap<Text, Principal>(initialCapacity, Text.equal, Text.hash);
    
    for ((principal, name) in playerEntries.vals()) {
      players.put(principal, name);
      usedNames.put(name, principal);
    };
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
            return #ok("Successfully registered as " # name);
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
      case (?principal) { true };
      case null { false };
    }
  };

  // Clear all player data (for development purposes)
  public func clearAllPlayers() : async () {
    playerEntries := [];
    players := HashMap.HashMap<Principal, Text>(0, Principal.equal, Principal.hash);
    usedNames := HashMap.HashMap<Text, Principal>(0, Text.equal, Text.hash);
  };
};
