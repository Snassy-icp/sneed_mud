// ItemUtils.mo - Utility functions for item management
//
// IMPORTANT: Byte Order Convention
// ------------------------------
// All byte-level operations in this codebase use little-endian order.
// This means:
// - When converting numbers to bytes: least significant byte is written first
// - When reading bytes as numbers: first byte is least significant
// - This applies to all ID encodings in subaccounts (room IDs, item IDs)
//
// Example:
// - Number 258 (0x102) is stored as [0x02, 0x01, 0x00, ...]
// - When reading [0x02, 0x01, 0x00, ...] we get 258 (2 + 1*256 + 0*65536)

import Principal "mo:base/Principal";
import Types "./Types";
import State "./State";
import Buffer "mo:base/Buffer";
import Blob "mo:base/Blob";
import Array "mo:base/Array";
import Nat8 "mo:base/Nat8";
import Debug "mo:base/Debug";
import Hash "mo:base/Hash";
import Set "mo:base/TrieSet";
import Nat "mo:base/Nat";
import Text "mo:base/Text";
import Nat32 "mo:base/Nat32";

module {
  type Account = Types.Account;
  type Item = Types.Item;
  type ItemId = Types.ItemId;
  type ItemType = Types.ItemType;
  type ItemTypeId = Types.ItemTypeId;
  type MudState = State.MudState;

  // Create subaccount for room ownership
  public func createRoomSubaccount(roomId: Types.RoomId) : Blob {
    let bytes = Array.init<Nat8>(32, 0);
    bytes[0] := 32; // Length byte
    bytes[1] := 1;  // Type byte (1 for room ownership)
    
    // Convert roomId to bytes (little-endian)
    var n = roomId;
    var pos = 2; // Start at position 2 (after length and type bytes)
    
    // Write the ID bytes in little-endian order
    while (n > 0) {
      bytes[pos] := Nat8.fromNat(n % 256);
      n := n / 256;
      pos += 1;
    };
    
    Blob.fromArray(Array.freeze(bytes))
  };

  // Create subaccount for item ownership
  public func createItemSubaccount(itemId: Nat) : Blob {
    let bytes = Array.init<Nat8>(32, 0);
    bytes[0] := 32; // Length byte
    bytes[1] := 2;  // Type byte (2 for item ownership)
    
    // Convert itemId to bytes (little-endian)
    var n = itemId;
    var pos = 2; // Start at position 2 (after length and type bytes)
    
    // Write the ID bytes in little-endian order
    while (n > 0) {
      bytes[pos] := Nat8.fromNat(n % 256);
      n := n / 256;
      pos += 1;
    };
    
    Blob.fromArray(Array.freeze(bytes))
  };

  // Helper to convert Nat to bytes (little-endian)
  private func nat_to_bytes(n: Nat) : [Nat8] {
    var remaining = n;
    let bytes = Buffer.Buffer<Nat8>(8); // Assuming max 8 bytes needed
    
    while (remaining > 0) {
      bytes.add(Nat8.fromNat(remaining % 256));
      remaining := remaining / 256;
    };
    
    Buffer.toArray(bytes)
  };

  // Helper function to hash Nat to Nat32
  private func hashNat(n: Nat) : Nat32 {
    let hash : Nat32 = Nat32.fromNat(n);
    hash
  };

  // Check if an item exists in the ownership chain of another item
  public func detectCycle(state: MudState, startItemId: ItemId, targetItemId: ItemId) : Bool {
    let visited = Set.empty<ItemId>();
    
    func visit(currentId: ItemId) : Bool {
      if (currentId == targetItemId) {
        return true; // Found cycle
      };
      
      let hash : Nat32 = hashNat(currentId);
      if (Set.mem<ItemId>(visited, currentId, hash, Nat.equal)) {
        return false; // Already visited, no cycle found yet
      };
      
      // Add current item to visited set
      let newVisited = Set.put<ItemId>(visited, currentId, hash, Nat.equal);
      
      // Get the item's owner
      switch (state.items.get(currentId)) {
        case null { false };
        case (?item) {
          switch (item.owner.subaccount) {
            case null { false }; // Player owned, end of chain
            case (?subaccount) {
              if (Blob.equal(subaccount, createItemSubaccount(targetItemId))) {
                true // Direct ownership by target item
              } else {
                // Check if owned by another item
                let ownerBytes = Blob.toArray(subaccount);
                if (ownerBytes.size() > 1 and ownerBytes[1] == 2) {
                  // Extract item ID from subaccount and continue checking
                  let ownerId = bytes_to_nat(Array.tabulate<Nat8>(
                    ownerBytes.size() - 2,
                    func(i) { ownerBytes[i + 2] }
                  ));
                  visit(ownerId)
                } else {
                  false // Room owned or invalid subaccount
                }
              }
            };
          }
        };
      }
    };
    
    visit(startItemId)
  };

  // Helper to convert bytes back to Nat
  public func bytes_to_nat(bytes: [Nat8]) : Nat {
    var n = 0;
    var shift = 0;
    
    for (b in bytes.vals()) {
      n += Nat8.toNat(b) * (256 ** shift);
      shift += 1;
    };
    
    n
  };

  // Check if a player can access an item (through room or container chain)
  public func canAccessItem(state: MudState, itemId: ItemId, playerPrincipal: Principal) : Bool {
    let visited = Set.empty<ItemId>();
    
    func checkAccess(currentId: ItemId) : Bool {
      let hash : Nat32 = hashNat(currentId);
      if (Set.mem<ItemId>(visited, currentId, hash, Nat.equal)) {
        return false; // Already visited, prevent infinite loops
      };
      
      // Add current item to visited set
      let newVisited = Set.put<ItemId>(visited, currentId, hash, Nat.equal);
      
      switch (state.items.get(currentId)) {
        case null { false };
        case (?item) {
          // Check if player owns the item directly
          if (Principal.equal(item.owner.owner, playerPrincipal) and item.owner.subaccount == null) {
            return true;
          };
          
          switch (item.owner.subaccount) {
            case null { false }; // Player owned but not by this player
            case (?subaccount) {
              let ownerBytes = Blob.toArray(subaccount);
              if (ownerBytes.size() > 1) {
                switch (ownerBytes[1]) {
                  case (1) { // Room owned
                    // Check if player is in this room
                    let roomId = bytes_to_nat(Array.tabulate<Nat8>(
                      ownerBytes.size() - 2,
                      func(i) { ownerBytes[i + 2] }
                    ));
                    switch (state.playerLocations.get(playerPrincipal)) {
                      case (?location) { location == roomId };
                      case null { false };
                    }
                  };
                  case (2) { // Item owned
                    // Get the owner item ID and check if it's accessible
                    let ownerId = bytes_to_nat(Array.tabulate<Nat8>(
                      ownerBytes.size() - 2,
                      func(i) { ownerBytes[i + 2] }
                    ));
                    // Check if the container is open
                    switch (state.items.get(ownerId)) {
                      case (?ownerItem) {
                        if (not ownerItem.is_open) {
                          return false;
                        };
                        // Check if the owner item's type is a container
                        switch (state.itemTypes.get(ownerItem.type_id)) {
                          case (?itemType) {
                            if (not itemType.is_container) {
                              return false;
                            };
                            checkAccess(ownerId)
                          };
                          case null { false };
                        }
                      };
                      case null { false };
                    }
                  };
                  case (_) { false }; // Invalid type byte
                }
              } else {
                false // Invalid subaccount format
              }
            };
          }
        };
      }
    };
    
    checkAccess(itemId)
  };
} 