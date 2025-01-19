import Types "Types";
import State "State";
import Time "mo:base/Time";
import Result "mo:base/Result";
import Int "mo:base/Int";
import Nat "mo:base/Nat";
import Principal "mo:base/Principal";

module {
  // Constants
  private let COMBAT_DURATION_NS = 20_000_000_000; // 20 seconds
  private let ATTACK_COOLDOWN_NS = 5_000_000_000;  // 5 seconds
  
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

  // Process an attack between two players
  public func processPlayerAttack(state: State.MudState, attacker: Principal, target: Principal) : Result.Result<Types.AttackResult, Text> {
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
                    
                    // Update target's HP
                    let targetNewHp = if (damage >= targetDynamic.hp) { 0 } else { targetDynamic.hp - damage };
                    let updatedTargetStats = {
                      hp = targetNewHp;
                      mp = targetDynamic.mp;
                      xp = targetDynamic.xp;
                    };
                    state.playerDynamicStats.put(target, updatedTargetStats);

                    // Update combat states
                    updateCombatState(state, attacker);
                    updateCombatState(state, target);

                    // Return result
                    #ok({
                      damage = damage;
                      attackerNewHp = attackerDynamic.hp;
                      targetNewHp = targetNewHp;
                      counterDamage = null;
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