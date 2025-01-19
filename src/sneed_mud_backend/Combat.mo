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
  // Constants
  private let COMBAT_DURATION_NS = 20_000_000_000; // 20 seconds
  private let ATTACK_COOLDOWN_NS = 5_000_000_000;  // 5 seconds
  private let RESPAWN_DELAY_NS = 60_000_000_000;   // 60 seconds until auto-respawn
  
  // Check if a player is in combat
  public func isInCombat(state: State.MudState, principal: Principal) : Bool {
    switch (state.playerCombatStates.get(principal)) {
      case null { false };
      case (?combatState) {
        if (combatState.inCombat and Time.now() < combatState.combatEndTime) {
          true
        } else {
          // Auto-remove expired combat state
          state.playerCombatStates.delete(principal);
          false
        }
      };
    };
  };

  // Calculate base damage based on attacker's level
  private func calculateDamage(attackerLevel: Nat) : Nat {
    // Simple formula: 5 + (level * 2) damage
    5 + (attackerLevel * 2)
  };

  // Update combat state for a player
  private func updateCombatState(state: State.MudState, principal: Principal) {
    let now = Time.now();
    let combatState = {
      inCombat = true;
      combatEndTime = now + COMBAT_DURATION_NS;
      lastAttackTime = now;
    };
    state.playerCombatStates.put(principal, combatState);
  };

  // Check if player can attack (cooldown expired)
  private func canAttack(state: State.MudState, principal: Principal) : Bool {
    switch (state.playerCombatStates.get(principal)) {
      case null { true };
      case (?combatState) {
        Time.now() > combatState.lastAttackTime + ATTACK_COOLDOWN_NS
      };
    };
  };

  // Check if a player should respawn
  public func checkAndHandleRespawn(state: State.MudState, principal: Principal) {
    switch (state.playerDynamicStats.get(principal)) {
      case null { return };
      case (?stats) {
        if (stats.isDead and Option.isSome(stats.deathTime)) {
          let deathTime = Option.unwrap(stats.deathTime);
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

  // Process an attack between two players
  public func processPlayerAttack(state: State.MudState, attacker: Principal, target: Principal) : Result.Result<Types.AttackResult, Text> {
    // Check if attacker is dead
    switch (state.playerDynamicStats.get(attacker)) {
      case null { return #err("Attacker has no stats") };
      case (?attackerStats) {
        if (attackerStats.isDead) {
          return #err("You cannot attack while dead");
        };
      };
    };

    // Check if target is already dead
    switch (state.playerDynamicStats.get(target)) {
      case null { return #err("Target has no stats") };
      case (?targetStats) {
        if (targetStats.isDead) {
          return #err("Target is already dead");
        };
      };
    };

    // Check if attacker can attack (cooldown)
    if (not canAttack(state, attacker)) {
      return #err("You must wait for your attack cooldown");
    };

    // Get attacker stats
    switch (state.playerBaseStats.get(attacker)) {
      case null { return #err("Attacker has no stats") };
      case (?attackerBase) {
        switch (state.playerDynamicStats.get(attacker)) {
          case null { return #err("Attacker has no dynamic stats") };
          case (?attackerDynamic) {
            // Get target stats
            switch (state.playerBaseStats.get(target)) {
              case null { return #err("Target has no stats") };
              case (?targetBase) {
                switch (state.playerDynamicStats.get(target)) {
                  case null { return #err("Target has no dynamic stats") };
                  case (?targetDynamic) {
                    // Calculate damage
                    let damage = calculateDamage(attackerBase.level);
                    
                    // Update target's HP and check for death
                    let targetNewHp = if (damage >= targetDynamic.hp) { 0 } else { targetDynamic.hp - damage };
                    let targetDied = targetNewHp == 0;
                    
                    let updatedTargetStats = {
                      hp = targetNewHp;
                      mp = targetDynamic.mp;
                      xp = targetDynamic.xp;
                      isDead = targetDied;
                      deathTime = if (targetDied) { ?Time.now() } else { targetDynamic.deathTime };
                    };
                    state.playerDynamicStats.put(target, updatedTargetStats);

                    // If target died, award XP to attacker
                    if (targetDied) {
                      let xpGain = 100 + targetBase.level * 50;  // Simple XP formula
                      let updatedAttackerStats = {
                        hp = attackerDynamic.hp;
                        mp = attackerDynamic.mp;
                        xp = attackerDynamic.xp + xpGain;
                        isDead = attackerDynamic.isDead;
                        deathTime = attackerDynamic.deathTime;
                      };
                      state.playerDynamicStats.put(attacker, updatedAttackerStats);
                    };

                    // Update combat states
                    updateCombatState(state, attacker);
                    if (not targetDied) {
                      updateCombatState(state, target);
                    };

                    // Return result
                    #ok({
                      damage = damage;
                      attackerNewHp = attackerDynamic.hp;
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
    };
  };
}; 