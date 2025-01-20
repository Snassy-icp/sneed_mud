import Types "Types";
import Principal "mo:base/Principal";
import Result "mo:base/Result";
import Int "mo:base/Int";
import Nat "mo:base/Nat";
import Text "mo:base/Text";
import HashMap "mo:base/HashMap";

module {
  // Class type definition
  public type Class = {
    name: Text;
    description: Text;
    isAdminClass: Bool;  // True only for the temporary admin class
    baseStats: Types.BaseStats;
    // Growth multipliers for level-up calculations
    growthRates: Types.ClassGrowthRates;
  };

  // Admin class constants
  private let ADMIN_CLASS_NAME = "God";
  private let ADMIN_CLASS_DESCRIPTION = "Temporary divine class for realm creation";
  private let ADMIN_BASE_STAT = 10;
  private let ADMIN_BASE_GROWTH = 5;

  // Create the admin class with balanced stats
  public func createAdminClass() : Types.Class {
    {
      name = ADMIN_CLASS_NAME;
      description = ADMIN_CLASS_DESCRIPTION;
      isAdminClass = true;
      baseStats = {
        level = 1;
        baseHp = 100;
        baseMp = 100;
        basePhysicalAttack = ADMIN_BASE_STAT;
        basePhysicalDefense = ADMIN_BASE_STAT;
        baseMagicAttack = ADMIN_BASE_STAT;
        baseMagicDefense = ADMIN_BASE_STAT;
        baseAttackSpeed = 100;
        strength = ADMIN_BASE_STAT;
        dexterity = ADMIN_BASE_STAT;
        constitution = ADMIN_BASE_STAT;
        intelligence = ADMIN_BASE_STAT;
        wisdom = ADMIN_BASE_STAT;
        maxHp = 100;
        maxMp = 100;
        physicalAttack = ADMIN_BASE_STAT;
        physicalDefense = ADMIN_BASE_STAT;
        magicAttack = ADMIN_BASE_STAT;
        magicDefense = ADMIN_BASE_STAT;
        attackSpeed = 100;
        dodgeChance = 200;  // 2% base dodge
        criticalChance = 500; // 5% base crit
      };
      growthRates = {
        hpPerLevel = ADMIN_BASE_GROWTH;
        mpPerLevel = ADMIN_BASE_GROWTH;
        hpPerCon = ADMIN_BASE_GROWTH;
        mpPerWis = ADMIN_BASE_GROWTH;
        physicalAttackPerStr = ADMIN_BASE_GROWTH;
        physicalDefensePerCon = ADMIN_BASE_GROWTH;
        magicAttackPerInt = ADMIN_BASE_GROWTH;
        magicDefensePerWis = ADMIN_BASE_GROWTH;
        attackSpeedPerDex = 20;  // 0.2% per point
      };
    }
  };

  // Check if a player should get the admin class
  public func shouldGetAdminClass(classes: HashMap.HashMap<Text, Types.Class>, isRealmOwner: Bool) : Bool {
    isRealmOwner and classes.size() == 0
  };

  // Create a new class with default values
  public func createClass(name: Text, description: Text) : Types.Class {
    {
      name = name;
      description = description;
      isAdminClass = false;
      baseStats = createDefaultBaseStats();
      growthRates = createDefaultGrowthRates();
    }
  };

  // Create default base stats for a new class
  private func createDefaultBaseStats() : Types.BaseStats {
    {
      level = 1;
      baseHp = 100;
      baseMp = 100;
      basePhysicalAttack = 10;
      basePhysicalDefense = 10;
      baseMagicAttack = 10;
      baseMagicDefense = 10;
      baseAttackSpeed = 100;
      strength = 10;
      dexterity = 10;
      constitution = 10;
      intelligence = 10;
      wisdom = 10;
      maxHp = 100;
      maxMp = 100;
      physicalAttack = 10;
      physicalDefense = 10;
      magicAttack = 10;
      magicDefense = 10;
      attackSpeed = 100;
      dodgeChance = 200;  // 2% base dodge
      criticalChance = 500; // 5% base crit
    }
  };

  // Create default growth rates for a new class
  private func createDefaultGrowthRates() : Types.ClassGrowthRates {
    {
      hpPerLevel = 5;
      mpPerLevel = 5;
      hpPerCon = 5;
      mpPerWis = 5;
      physicalAttackPerStr = 5;
      physicalDefensePerCon = 5;
      magicAttackPerInt = 5;
      magicDefensePerWis = 5;
      attackSpeedPerDex = 20;
    }
  };
} 