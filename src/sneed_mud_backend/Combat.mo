import Types "Types";
import State "State";
import Time "mo:base/Time";
import Result "mo:base/Result";
import Int "mo:base/Int";
import Nat "mo:base/Nat";
import Principal "mo:base/Principal";
import Option "mo:base/Option";
import Lib "./lib";

module {
  type MudState = State.MudState;
  type AttackResult = Types.AttackResult;

  // Constants
  private let COMBAT_DURATION_NS = 20_000_000_000; // 20 seconds
  private let ATTACK_COOLDOWN_NS = 5_000_000_000;  // 5 seconds
  private let RESPAWN_DELAY_NS = 60_000_000_000;   // 60 seconds until auto-respawn
  
  // Check if a player is in combat
  public func isInCombat(state: MudState, principal: Principal) : Bool {
    switch (state.playerCombatStates.get(principal)) {
      case null { false };
      case (?combatState) {
        combatState.inCombat and Time.now() < combatState.combatEndTime
      };
    };
  };

  // Calculate damage based on attacker's level
  private func calculateDamage(state: MudState, attacker: Principal) : Nat {
    switch (state.playerBaseStats.get(attacker)) {
      case null { 1 }; // Default damage if no stats
      case (?stats) {
        // Simple formula: level * 2 + 1
        // Add explicit checks to prevent traps
        let baseDamage = stats.level * 2;
        baseDamage + 1
      };
    };
  };

  // Update combat state for a player
  private func _updateCombatState(state: MudState, principal: Principal) {
    let now = Time.now();
    let combatState = {
      inCombat = true;
      combatEndTime = now + COMBAT_DURATION_NS;
      lastAttackTime = now;
    };
    state.playerCombatStates.put(principal, combatState);
  };

  // Check if player can attack (cooldown expired)
  private func _canAttack(state: MudState, principal: Principal) : Bool {
    switch (state.playerCombatStates.get(principal)) {
      case null { true };
      case (?combatState) {
        Time.now() > combatState.lastAttackTime + ATTACK_COOLDOWN_NS
      };
    };
  };

  // Check if a player should respawn
  public func checkAndHandleRespawn(state: MudState, principal: Principal) {
    switch (state.playerDynamicStats.get(principal)) {
      case null { return };
      case (?stats) {
        if (stats.isDead and Option.isSome(stats.deathTime)) {
          switch (stats.deathTime) {
            case null { return };
            case (?deathTime) {
              if (Time.now() >= deathTime + RESPAWN_DELAY_NS) {
                // Respawn the player
                let baseStats = switch (state.playerBaseStats.get(principal)) {
                  case null { return };
                  case (?base) { base };
                };
                
                let updatedStats = {
                  hp = baseStats.maxHp;
                  mp = stats.mp;
                  xp = stats.xp;
                  isDead = false;
                  deathTime = null;
                };
                state.playerDynamicStats.put(principal, updatedStats);
                
                // Move player to starting room
                state.playerLocations.put(principal, 0);
                
                // Broadcast respawn message
                switch (state.players.get(principal)) {
                  case null { return };
                  case (?name) {
                    Lib.broadcastToRoom(state, 0, name # " has respawned.");
                  };
                };
              };
            };
          };
        };
      };
    };
  };

  // Process an attack between two players
  private func processAttack(state: MudState, attacker: Principal, target: Principal) : Result.Result<AttackResult, Text> {
    // Check if attacker can perform combat actions
    switch (State.canPerformAction(state, attacker, #Combat)) {
      case (#err(e)) { return #err(e) };
      case (#ok(_)) {
        // Get attacker stats
        switch (state.playerDynamicStats.get(attacker)) {
          case null { return #err("Attacker has no stats") };
          case (?attackerStats) {
            // Get target stats
            switch (state.playerDynamicStats.get(target)) {
              case null { return #err("Target has no stats") };
              case (?targetStats) {
                if (targetStats.isDead) {
                  return #err("Target is already dead");
                };

                // Calculate damage
                let damage = calculateDamage(state, attacker);

                // Calculate new HP
                let targetNewHp = if (damage >= targetStats.hp) { 
                  0 
                } else { 
                  targetStats.hp - damage 
                };
                let targetDied = targetNewHp == 0;

                // Update target's stats
                let updatedTargetStats = {
                  hp = targetNewHp;
                  mp = targetStats.mp;
                  xp = targetStats.xp;
                  isDead = targetDied;
                  deathTime = if (targetDied) { ?Time.now() } else { null };
                };
                state.playerDynamicStats.put(target, updatedTargetStats);

                // Update combat states
                let now = Time.now();
                let combatEndTime = now + COMBAT_DURATION_NS;

                // Update attacker's combat state
                state.playerCombatStates.put(attacker, {
                  inCombat = true;
                  combatEndTime = combatEndTime;
                  lastAttackTime = now;
                });

                // Update target's combat state
                state.playerCombatStates.put(target, {
                  inCombat = true;
                  combatEndTime = combatEndTime;
                  lastAttackTime = now;
                });

                #ok({
                  damage = damage;
                  attackerNewHp = attackerStats.hp;
                  targetNewHp = targetNewHp;
                  counterDamage = null;
                  targetDied = targetDied;
                })
              };
            };
          };
        };
      };
    }
  };

  // Process a player's attack on another player
  public func processPlayerAttack(state: MudState, attacker: Principal, targetName: Text) : async Result.Result<(), Text> {
    // First check if the target exists
    switch (State.findPrincipalByName(state, targetName)) {
      case null { #err("Player not found: " # targetName) };
      case (?targetPrincipal) {
        // Check if target is in the same room
        switch (state.playerLocations.get(attacker)) {
          case null { #err("You are not in any room") };
          case (?attackerRoom) {
            switch (state.playerLocations.get(targetPrincipal)) {
              case null { #err("Target is not in any room") };
              case (?targetRoom) {
                if (attackerRoom != targetRoom) {
                  return #err("Target is not in the same room");
                };

                // Process the attack
                switch (processAttack(state, attacker, targetPrincipal)) {
                  case (#err(e)) { #err(e) };
                  case (#ok(result)) {
                    // Get player names for the message
                    let attackerName = switch (state.players.get(attacker)) {
                      case null { "Unknown" };
                      case (?name) { name };
                    };
                    let targetName = switch (state.players.get(targetPrincipal)) {
                      case null { "Unknown" };
                      case (?name) { name };
                    };

                    // Create combat message
                    let message = attackerName # " attacks " # targetName # " for " # 
                                Nat.toText(result.damage) # " damage! " # targetName # 
                                " has " # Nat.toText(result.targetNewHp) # " HP remaining.";

                    // Add death message if target died
                    let finalMessage = if (result.targetDied) {
                      message # "\n" # targetName # " has been slain!";
                    } else {
                      message
                    };

                    // Broadcast to room
                    Lib.broadcastToRoom(state, attackerRoom, finalMessage);

                    // Check for respawns
                    checkAndHandleRespawn(state, targetPrincipal);

                    #ok(())
                  };
                }
              };
            };
          };
        };
      };
    }
  };

  // Process a player's respawn request
  public func processPlayerRespawn(state: MudState, caller: Principal) : Result.Result<(), Text> {
    switch (state.players.get(caller)) {
      case null { #err("You need to register a name first") };
      case (?playerName) {
        // Check if player can respawn
        switch (State.canPerformAction(state, caller, #Respawn)) {
          case (#err(e)) { #err(e) };
          case (#ok(_)) {
            // Get base stats for HP reset
            switch (state.playerBaseStats.get(caller)) {
              case null { #err("No character found") };
              case (?baseStats) {
                switch (state.playerDynamicStats.get(caller)) {
                  case null { #err("No character found") };
                  case (?dynamicStats) {
                    // Update player stats
                    let updatedStats = {
                      hp = baseStats.maxHp;
                      mp = dynamicStats.mp;
                      xp = dynamicStats.xp;
                      isDead = false;
                      deathTime = null;
                    };
                    state.playerDynamicStats.put(caller, updatedStats);
                    
                    // Move to starting room
                    state.playerLocations.put(caller, 0);
                    
                    // Broadcast respawn
                    Lib.broadcastToRoom(state, 0, playerName # " has respawned.");
                    
                    #ok(())
                  };
                };
              };
            };
          };
        };
      };
    };
  };
}; 