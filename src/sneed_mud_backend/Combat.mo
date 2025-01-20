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
  private let XP_PENALTY_DURATION_NS = 1_800_000_000_000; // 30 minutes in nanoseconds
  
  // Accuracy thresholds (stored as percentage * 100)
  private let BASE_MISS_THRESHOLD : Nat = 1000;     // 10% chance to miss
  private let BASE_GLANCING_THRESHOLD : Nat = 4000; // 30% chance for glancing blow
  private let BASE_CRIT_THRESHOLD : Nat = 9500;     // 5% chance to crit
  private let DEX_ACCURACY_BONUS : Nat = 20;        // 0.2% improvement per point of Dexterity
  private let MIN_MISS_THRESHOLD : Nat = 200;       // Minimum 2% chance to miss
  private let MIN_GLANCING_THRESHOLD : Nat = 1000;  // Minimum 10% chance for glancing
  private let MAX_CRIT_CHANCE : Nat = 1000;         // Maximum 10% chance to crit

  // Check if a player is in combat
  public func isInCombat(state: MudState, principal: Principal) : Bool {
    switch (state.playerCombatStates.get(principal)) {
      case null { false };
      case (?combatState) {
        combatState.inCombat and Time.now() < combatState.combatEndTime
      };
    };
  };

  // Calculate attack outcome based on attacker's dexterity
  private func calculateAttackOutcome(attackerDexterity: Nat) : {
    isMiss: Bool;
    isGlancing: Bool;
    isCrit: Bool;
  } {
    let dexBonus = attackerDexterity * DEX_ACCURACY_BONUS;
    
    // Calculate adjusted thresholds
    let missThreshold = Nat.max(MIN_MISS_THRESHOLD, 
      if (dexBonus > BASE_MISS_THRESHOLD) { 0 } else { BASE_MISS_THRESHOLD - dexBonus });
    
    let glancingThreshold = Nat.max(MIN_GLANCING_THRESHOLD,
      if (dexBonus > BASE_GLANCING_THRESHOLD) { 0 } else { BASE_GLANCING_THRESHOLD - dexBonus });
    
    // Crit chance increases with dexterity up to cap
    let critThreshold = Nat.min(10000 - MAX_CRIT_CHANCE,
      BASE_CRIT_THRESHOLD - Nat.min(dexBonus, (MAX_CRIT_CHANCE - (10000 - BASE_CRIT_THRESHOLD))));
    
    // Single roll for all outcomes
    let roll = Time.now() % 10000;
    
    {
      isMiss = roll < missThreshold;
      isGlancing = not (roll < missThreshold) and roll < glancingThreshold;
      isCrit = roll >= critThreshold;
    }
  };

  // Calculate damage based on attacker and target stats
  private func calculateDamage(state: MudState, attacker: Principal, target: Principal) : { 
    damage: Nat; 
    wasCrit: Bool; 
    wasGlancing: Bool;
    wasMiss: Bool;
  } {
    switch (state.playerBaseStats.get(attacker), state.playerBaseStats.get(target)) {
      case (null, _) { { 
        damage = 1; 
        wasCrit = false; 
        wasGlancing = false;
        wasMiss = false;
      } }; // Default if no attacker stats
      case (_, null) { { 
        damage = 1; 
        wasCrit = false; 
        wasGlancing = false;
        wasMiss = false;
      } }; // Default if no target stats
      case (?attackerStats, ?targetStats) {
        // Calculate accuracy outcome
        let outcome = calculateAttackOutcome(attackerStats.dexterity);
        
        if (outcome.isMiss) {
          return { 
            damage = 0; 
            wasCrit = false; 
            wasGlancing = false;
            wasMiss = true;
          };
        };

        // Calculate base damage
        let attack = attackerStats.physicalAttack;
        let defense = targetStats.physicalDefense;
        let baseDamage = (attack * 100) / (100 + defense);
        
        // Apply outcome modifiers
        let finalDamage = if (outcome.isCrit) {
          baseDamage * 2  // Critical hit: 200% damage
        } else if (outcome.isGlancing) {
          (baseDamage * 60) / 100  // Glancing blow: 60% damage
        } else {
          baseDamage  // Normal hit: 100% damage
        };

        { 
          damage = finalDamage;
          wasCrit = outcome.isCrit;
          wasGlancing = outcome.isGlancing;
          wasMiss = false;
        }
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
                
                let updatedStats : Types.DynamicStats = {
                  hp = baseStats.maxHp;
                  mp = stats.mp;
                  xp = stats.xp;
                  isDead = false;
                  deathTime = null;
                  xpPenaltyEndTime = stats.xpPenaltyEndTime;  // Keep existing penalty
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

  // Calculate XP gain with penalty consideration
  private func calculateXpGain(state: MudState, attacker: Principal, targetLevel: Nat) : Nat {
    let baseXp = targetLevel * 15;
    
    // Check if attacker has XP penalty
    switch (state.playerDynamicStats.get(attacker)) {
      case null { baseXp };
      case (?stats) {
        switch (stats.xpPenaltyEndTime) {
          case null { baseXp };
          case (?endTime) {
            if (Time.now() >= endTime) {
              baseXp  // Penalty expired
            } else {
              baseXp / 2  // 50% penalty
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

                    // Calculate damage and get combat results
                    let result = calculateDamage(state, attacker, target);
                    let targetNewHp = if (result.damage >= targetStats.hp) { 
                      0 
                    } else { 
                      targetStats.hp - result.damage 
                    };
                    let targetDied = targetNewHp == 0;

                    // Update target's stats
                    let updatedTargetStats : Types.DynamicStats = {
                      hp = targetNewHp;
                      mp = targetStats.mp;
                      xp = targetStats.xp;
                      isDead = targetDied;
                      deathTime = if (targetDied) { ?Time.now() } else { null };
                      xpPenaltyEndTime = if (targetDied) { ?(Time.now() + XP_PENALTY_DURATION_NS) } else { targetStats.xpPenaltyEndTime };
                    };
                    state.playerDynamicStats.put(target, updatedTargetStats);

                    // If target died, award XP to attacker
                    if (targetDied) {
                      let targetLevel = switch (state.playerBaseStats.get(target)) {
                        case null { 1 }; // Base level if no stats
                        case (?targetBase) { targetBase.level };
                      };
                      let xpGain = calculateXpGain(state, attacker, targetLevel);
                      
                      // Update attacker's XP
                      let updatedAttackerStats : Types.DynamicStats = {
                        hp = attackerStats.hp;
                        mp = attackerStats.mp;
                        xp = attackerStats.xp + xpGain;
                        isDead = attackerStats.isDead;
                        deathTime = attackerStats.deathTime;
                        xpPenaltyEndTime = attackerStats.xpPenaltyEndTime;
                      };
                      state.playerDynamicStats.put(attacker, updatedAttackerStats);

                      // Check for level up
                      let _ = Lib.checkAndHandleLevelUp(state, attacker);
                    };

                    // Update combat states for both players
                    updateCombatState(state, attacker, true);
                    updateCombatState(state, target, false);

                    #ok({
                      damage = result.damage;
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
                        let damageResult = calculateDamage(state, attacker, targetPrincipal);
                        
                        // Build the combat message
                        let message = if (damageResult.wasMiss) {
                          attackerName # " attacks " # targetName # " but misses!";
                        } else if (damageResult.wasGlancing) {
                          attackerName # " lands a glancing blow on " # targetName # 
                            " for " # Nat.toText(result.damage) # " damage! " #
                            targetName # " has " # Nat.toText(result.targetNewHp) # " HP remaining.";
                        } else {
                          let hitType = if (damageResult.wasCrit) { " CRITICAL HIT! " } else { " " };
                          attackerName # " attacks " # targetName # "." # hitType # 
                            "Deals " # Nat.toText(result.damage) # " damage! " #
                            targetName # " has " # Nat.toText(result.targetNewHp) # " HP remaining.";
                        };
                        
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
                    let updatedStats : Types.DynamicStats = {
                      hp = baseStats.maxHp;
                      mp = dynamicStats.mp;
                      xp = dynamicStats.xp;
                      isDead = false;
                      deathTime = null;
                      xpPenaltyEndTime = dynamicStats.xpPenaltyEndTime;  // Keep existing penalty
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