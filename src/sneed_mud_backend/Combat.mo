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
  type CombatState = Types.CombatState;

  // Constants
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
        let baseDamage = stats.level * 20;
        baseDamage + 10
      };
    };
  };

  // Check if player can perform an action (global cooldown)
  private func canPerformAction(state: MudState, principal: Principal) : Bool {
    switch (state.playerCombatStates.get(principal)) {
      case null { true };
      case (?combatState) {
        Time.now() > combatState.lastGlobalCooldown + Lib.GLOBAL_COOLDOWN_NS
      };
    };
  };

  // Check if player can use basic attack (considering both cooldowns)
  private func canUseBasicAttack(state: MudState, principal: Principal) : Result.Result<(), Text> {
    switch (state.playerCombatStates.get(principal)) {
      case null { #ok(()) };  // No cooldowns if never attacked
      case (?combatState) {
        let now = Time.now();
        
        // Check global cooldown first
        if (now <= combatState.lastGlobalCooldown + Lib.GLOBAL_COOLDOWN_NS) {
          return #err("Global cooldown active");
        };

        // Get player's attack speed
        let attackSpeed = switch (state.playerBaseStats.get(principal)) {
          case null { Lib.BASE_ATTACK_SPEED };
          case (?stats) { stats.attackSpeed };
        };

        // Calculate reduced cooldown for basic attack
        let reducedCooldown = Lib.calculateReducedCooldown(Lib.BASIC_ATTACK_COOLDOWN_NS, attackSpeed);
        
        if (now <= combatState.lastBasicAttack + reducedCooldown) {
          #err("Basic attack on cooldown")
        } else {
          #ok(())
        };
      };
    };
  };

  // Update combat state for a player
  private func updateCombatState(state: MudState, principal: Principal, isBasicAttack: Bool) {
    let now = Time.now();
    let newState : CombatState = switch (state.playerCombatStates.get(principal)) {
      case null {
        {
          inCombat = true;
          combatEndTime = now + Lib.COMBAT_DURATION_NS;
          lastGlobalCooldown = now;
          lastBasicAttack = if (isBasicAttack) { now } else { 0 };
          abilityCooldowns = [];
        }
      };
      case (?existing) {
        {
          inCombat = true;
          combatEndTime = now + Lib.COMBAT_DURATION_NS;
          lastGlobalCooldown = now;
          lastBasicAttack = if (isBasicAttack) { now } else { existing.lastBasicAttack };
          abilityCooldowns = existing.abilityCooldowns;
        }
      };
    };
    state.playerCombatStates.put(principal, newState);
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
        // Check cooldowns
        switch (canUseBasicAttack(state, attacker)) {
          case (#err(e)) { return #err(e) };
          case (#ok(_)) {
            switch (state.playerDynamicStats.get(attacker)) {
              case null { return #err("Attacker has no stats") };
              case (?attackerStats) {
                switch (state.playerDynamicStats.get(target)) {
                  case null { return #err("Target has no stats") };
                  case (?targetStats) {
                    if (targetStats.isDead) {
                      return #err("Target is already dead");
                    };

                    // Calculate and apply damage
                    let damage = calculateDamage(state, attacker);
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

                    // If target died, award XP to attacker
                    if (targetDied) {
                      let xpGain = switch (state.playerBaseStats.get(target)) {
                        case null { 10 }; // Base XP if target has no level
                        case (?targetBase) { targetBase.level * 10 }; // XP based on target's level
                      };
                      let updatedAttackerStats = {
                        hp = attackerStats.hp;
                        mp = attackerStats.mp;
                        xp = attackerStats.xp + xpGain;
                        isDead = attackerStats.isDead;
                        deathTime = attackerStats.deathTime;
                      };
                      state.playerDynamicStats.put(attacker, updatedAttackerStats);
                    };

                    // Update combat states for both players
                    updateCombatState(state, attacker, true);
                    updateCombatState(state, target, false);

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
        };
      };
    }
  };

  // Public interface for processing player attacks
  public func processPlayerAttack(state: MudState, attacker: Principal, targetName: Text) : async Result.Result<(), Text> {
    // Find target principal
    switch (State.findPrincipalByName(state, targetName)) {
      case null { #err("Player not found: " # targetName) };
      case (?targetPrincipal) {
        if (attacker == targetPrincipal) {
          return #err("You cannot attack yourself");
        };
        
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
                
                switch (processAttack(state, attacker, targetPrincipal)) {
                  case (#err(e)) { #err(e) };
                  case (#ok(result)) {
                    // Broadcast attack result
                    switch (state.players.get(attacker), state.players.get(targetPrincipal)) {
                      case (?attackerName, ?targetName) {
                        let message = attackerName # " attacks " # targetName # 
                          " for " # Nat.toText(result.damage) # " damage! " #
                          targetName # " has " # Nat.toText(result.targetNewHp) # " HP remaining.";
                        Lib.broadcastToRoom(state, attackerRoom, message);
                        
                        if (result.targetDied) {
                          let deathMessage = targetName # " has been defeated!";
                          Lib.broadcastToRoom(state, attackerRoom, deathMessage);
                          checkAndHandleRespawn(state, targetPrincipal);
                        };
                      };
                      case _ { /* Names not found, skip message */ };
                    };
                    #ok(())
                  };
                }
              };
            };
          };
        }
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