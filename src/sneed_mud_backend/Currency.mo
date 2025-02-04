import Principal "mo:base/Principal";
import Result "mo:base/Result";
import Types "./Types";
import State "./State";
import Debug "mo:base/Debug";
import Time "mo:base/Time";
import Int "mo:base/Int";
import Nat "mo:base/Nat";
import Buffer "mo:base/Buffer";
import BufferUtils "./BufferUtils";

module {
  public type MudState = State.MudState;

  // Constants
  private let MAX_GOLD_CAP : Nat = 1_000_000; // 1M gold cap
  private let MIN_TRANSACTION : Nat = 1;

  // Transaction types
  public type TransactionType = {
    #Add;     // Gold added (from drops, selling, etc)
    #Remove;  // Gold removed (from buying, fees, etc)
  };

  public type Transaction = {
    id: Nat;
    timestamp: Int;
    player: Principal;
    amount: Nat;
    transactionType: TransactionType;
    description: Text;
  };

  // Add gold to a player's balance
  public func addGold(state: MudState, player: Principal, amount: Nat, description: Text) : Result.Result<(), Text> {
    if (amount < MIN_TRANSACTION) {
      return #err("Transaction amount must be at least " # Nat.toText(MIN_TRANSACTION) # " gold");
    };

    switch (state.playerDynamicStats.get(player)) {
      case null { #err("Player not found") };
      case (?stats) {
        let newGold = stats.gold + amount;
        if (newGold > MAX_GOLD_CAP) {
          return #err("Cannot exceed maximum gold cap (" # Nat.toText(MAX_GOLD_CAP) # ")");
        };

        let updatedStats : Types.DynamicStats = {
          hp = stats.hp;
          mp = stats.mp;
          xp = stats.xp;
          gold = newGold;
          isDead = stats.isDead;
          deathTime = stats.deathTime;
          xpPenaltyEndTime = stats.xpPenaltyEndTime;
        };
        
        // Log transaction
        logTransaction(state, {
          id = state.stable_state.nextMessageId;
          timestamp = Time.now();
          player = player;
          amount = amount;
          transactionType = #Add;
          description = description;
        });
        state.stable_state.nextMessageId += 1;
        
        state.playerDynamicStats.put(player, updatedStats);
        #ok(())
      };
    }
  };

  // Remove gold from a player's balance
  public func removeGold(state: MudState, player: Principal, amount: Nat, description: Text) : Result.Result<(), Text> {
    if (amount < MIN_TRANSACTION) {
      return #err("Transaction amount must be at least " # Nat.toText(MIN_TRANSACTION) # " gold");
    };

    switch (state.playerDynamicStats.get(player)) {
      case null { #err("Player not found") };
      case (?stats) {
        if (stats.gold < amount) {
          return #err("Insufficient gold");
        };

        let updatedStats : Types.DynamicStats = {
          hp = stats.hp;
          mp = stats.mp;
          xp = stats.xp;
          gold = stats.gold - amount;
          isDead = stats.isDead;
          deathTime = stats.deathTime;
          xpPenaltyEndTime = stats.xpPenaltyEndTime;
        };
        
        // Log transaction
        logTransaction(state, {
          id = state.stable_state.nextMessageId;
          timestamp = Time.now();
          player = player;
          amount = amount;
          transactionType = #Remove;
          description = description;
        });
        state.stable_state.nextMessageId += 1;
        
        state.playerDynamicStats.put(player, updatedStats);
        #ok(())
      };
    }
  };

  // Get a player's current gold balance
  public func getBalance(state: MudState, player: Principal) : Result.Result<Nat, Text> {
    switch (state.playerDynamicStats.get(player)) {
      case null { #err("Player not found") };
      case (?stats) { #ok(stats.gold) };
    }
  };

  // Calculate gold drop from NPC based on level
  public func calculateNpcGoldDrop(level: Nat) : Nat {
    let timestamp = Int.abs(Time.now());
    (level * 5) + (timestamp % 10) + 1
  };

  // Log a currency transaction
  private func logTransaction(state: MudState, transaction: Transaction) {
    // Add to player's message log
    switch (state.messageLogs.get(transaction.player)) {
      case null {
        // Create new message log if none exists
        let message = {
          id = transaction.id;
          timestamp = transaction.timestamp;
          content = formatTransactionMessage(transaction);
        };
        let cb = BufferUtils.createCircularBuffer();
        BufferUtils.addToCircularBuffer(cb, message);
        state.messageLogs.put(transaction.player, cb);
      };
      case (?cb) {
        let message = {
          id = transaction.id;
          timestamp = transaction.timestamp;
          content = formatTransactionMessage(transaction);
        };
        BufferUtils.addToCircularBuffer(cb, message);
      };
    };
  };

  // Format transaction message for logging
  private func formatTransactionMessage(transaction: Transaction) : Text {
    let actionText = switch (transaction.transactionType) {
      case (#Add) { "Gained" };
      case (#Remove) { "Spent" };
    };
    actionText # " " # Nat.toText(transaction.amount) # " gold" # 
    (if (transaction.description == "") { "" } else { " (" # transaction.description # ")" })
  };
} 