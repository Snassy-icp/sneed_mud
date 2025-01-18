import Principal "mo:base/Principal";
import Result "mo:base/Result";
import HashMap "mo:base/HashMap";
import Time "mo:base/Time";
import Types "./Types";
import State "./State";
import Debug "mo:base/Debug";
import Buffer "mo:base/Buffer";
import Iter "mo:base/Iter";
import Array "mo:base/Array";

module {
  public type MudState = State.MudState;

  // Helper function to check if metadata is stale (older than 1 week)
  public func isMetadataStale(lastRefreshed: Int) : Bool {
    let oneWeek = 7 * 24 * 60 * 60 * 1000000000; // 1 week in nanoseconds
    Time.now() - lastRefreshed > oneWeek
  };

  // Get metadata from cache if fresh
  public func getMetadata(state: MudState, ledgerCanisterId: Principal) : ?Types.TokenMetadata {
    switch (state.metadataCache.get(ledgerCanisterId)) {
      case (?metadata) {
        if (isMetadataStale(metadata.lastRefreshed)) {
          null // Return null if metadata is stale
        } else {
          ?metadata
        };
      };
      case null { null };
    }
  };

  // Register a new token for a user
  public func registerToken(
    state: MudState,
    caller: Principal,
    ledgerCanisterId: Principal,
    metadata: Types.TokenMetadata
  ) : Result.Result<(), Text> {
    // Update shared metadata cache
    state.metadataCache.put(ledgerCanisterId, metadata);

    // Get or create user's token list
    let userTokens = switch (state.registeredTokens.get(caller)) {
      case null {
        let newTokens : [Principal] = [];
        state.registeredTokens.put(caller, newTokens);
        newTokens
      };
      case (?tokens) { tokens };
    };

    // Check if token is already registered
    for (token in userTokens.vals()) {
      if (Principal.equal(token, ledgerCanisterId)) {
        return #err("Token already registered");
      };
    };

    // Add the new token
    let updatedTokens = Array.append(userTokens, [ledgerCanisterId]);
    state.registeredTokens.put(caller, updatedTokens);
    #ok(())
  };

  // Unregister a token for a user
  public func unregisterToken(
    state: MudState,
    caller: Principal,
    ledgerCanisterId: Principal
  ) : Result.Result<(), Text> {
    switch (state.registeredTokens.get(caller)) {
      case null { #err("No registered tokens found") };
      case (?tokens) {
        let updatedTokens = Array.filter(tokens, func(t: Principal) : Bool {
          not Principal.equal(t, ledgerCanisterId)
        });
        if (updatedTokens.size() == tokens.size()) {
          #err("Token not registered")
        } else {
          state.registeredTokens.put(caller, updatedTokens);
          #ok(())
        };
      };
    }
  };

  // Get all registered tokens for a user with metadata status
  public func getRegisteredTokens(
    state: MudState,
    caller: Principal
  ) : Result.Result<[Types.TokenInfo], Text> {
    switch (state.registeredTokens.get(caller)) {
      case null { #ok([]) };
      case (?tokens) {
        let result = Buffer.Buffer<Types.TokenInfo>(tokens.size());
        var hasStaleMetadata = false;
        
        for (ledgerCanisterId in tokens.vals()) {
          let metadata = getMetadata(state, ledgerCanisterId);
          if (metadata == null) {
            hasStaleMetadata := true;
          };
          result.add({
            ledgerCanisterId = ledgerCanisterId;
            metadata = metadata;
          });
        };
        
        if (hasStaleMetadata) {
          #err("Some token metadata is stale and needs refresh")
        } else {
          #ok(Buffer.toArray(result))
        }
      };
    }
  };

  // Update token metadata in shared cache
  public func updateTokenMetadata(
    state: MudState,
    caller: Principal,
    ledgerCanisterId: Principal,
    metadata: Types.TokenMetadata
  ) : Result.Result<(), Text> {
    // Verify the token is registered for this user
    switch (state.registeredTokens.get(caller)) {
      case null { #err("No registered tokens found") };
      case (?tokens) {
        var found = false;
        for (token in tokens.vals()) {
          if (Principal.equal(token, ledgerCanisterId)) {
            found := true;
          };
        };
        if (not found) {
          #err("Token not registered")
        } else {
          state.metadataCache.put(ledgerCanisterId, metadata);
          #ok(())
        };
      };
    }
  };
}; 