import Principal "mo:base/Principal";
import Types "./Types";
import State "./State";
import ItemUtils "./ItemUtils";
import Time "mo:base/Time";
import Result "mo:base/Result";
import Debug "mo:base/Debug";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Array "mo:base/Array";
import Nat8 "mo:base/Nat8";

module {
  type Account = Types.Account;
  type Item = Types.Item;
  type ItemId = Types.ItemId;
  type ItemType = Types.ItemType;
  type ItemTypeId = Types.ItemTypeId;
  type MudState = State.MudState;
  type ItemEvent = Types.ItemEvent;
  type ItemEventKind = Types.ItemEventKind;

  // Create a new item of a given type
  public func createItem(
    state: MudState,
    caller: Principal,
    typeId: ItemTypeId,
    count: ?Nat
  ) : Result.Result<ItemId, Text> {
    // Check if caller is a realm owner
    let isRealmOwner = State.isRealmOwner(state, caller);
    if (not isRealmOwner) {
      return #err("Only realm owners can create items");
    };

    // Validate item type exists
    switch (state.itemTypes.get(typeId)) {
      case null { return #err("Item type not found") };
      case (?itemType) {
        // Validate count is within stack limits
        let itemCount = switch (count) {
          case null { 1 };
          case (?c) {
            if (c == 0) {
              return #err("Count must be greater than 0");
            };
            if (c > itemType.stack_max) {
              return #err("Count exceeds maximum stack size for this item type");
            };
            c
          };
        };

        let itemId = state.stable_state.nextItemId;
        state.stable_state.nextItemId += 1;

        // Create item in player's inventory
        let owner : Account = {
          owner = caller;
          subaccount = null; // null subaccount means player inventory
        };

        let newItem : Item = {
          id = itemId;
          type_id = typeId;
          is_open = false;
          owner = owner;
          count = itemCount;
        };

        // Log creation event
        logItemEvent(state, {
          id = state.stable_state.nextMessageId;
          timestamp = Time.now();
          kind = #Mint;
          item_id = itemId;
          from = null;
          to = ?owner;
        });
        state.stable_state.nextMessageId += 1;

        state.items.put(itemId, newItem);
        #ok(itemId)
      };
    }
  };

  // Transfer an item to a new owner
  public func transferItem(
    state: MudState,
    caller: Principal,
    itemId: ItemId,
    newOwner: Account,
    transferCount: ?Nat
  ) : Result.Result<(), Text> {
    switch (state.items.get(itemId)) {
      case null { #err("Item not found") };
      case (?item) {
        // Check if caller can access the item
        if (not ItemUtils.canAccessItem(state, itemId, caller)) {
          return #err("You don't have access to this item");
        };

        // Get the item's type
        switch (state.itemTypes.get(item.type_id)) {
          case null { return #err("Item type not found") };
          case (?itemType) {
            // Check if we're transferring to a container
            switch (newOwner.subaccount) {
              case null { /* Not a container, no capacity check needed */ };
              case (?subaccount) {
                let ownerBytes = Blob.toArray(subaccount);
                if (ownerBytes.size() > 1 and ownerBytes[1] == 2) {
                  // Extract target container ID
                  let targetContainerId = ItemUtils.bytes_to_nat(Array.tabulate<Nat8>(
                    ownerBytes.size() - 2,
                    func(i) { ownerBytes[i + 2] }
                  ));

                  // Check for ownership cycles
                  if (itemType.is_container) {
                    if (ItemUtils.detectCycle(state, targetContainerId, itemId)) {
                      return #err("This transfer would create an ownership cycle");
                    };
                  };

                  // Get target container and its type
                  switch (state.items.get(targetContainerId)) {
                    case null { return #err("Target container not found") };
                    case (?targetContainer) {
                      switch (state.itemTypes.get(targetContainer.type_id)) {
                        case null { return #err("Target container type not found") };
                        case (?targetContainerType) {
                          if (not targetContainerType.is_container) {
                            return #err("Target is not a container");
                          };
                          if (not targetContainer.is_open) {
                            return #err("Target container is closed");
                          };

                          // Calculate space needed
                          let spaceNeeded = if (itemType.is_container) {
                            // If item is a container, it takes up slots equal to its capacity
                            switch (itemType.container_capacity) {
                              case null { return #err("Source container has no capacity defined") };
                              case (?capacity) { capacity };
                            };
                          } else {
                            // Non-container items take up 1 slot
                            1
                          };

                          // Check if target container has enough space
                          switch (targetContainerType.container_capacity) {
                            case null { /* No capacity limit */ };
                            case (?targetCapacity) {
                              // Count current items in target container
                              let containerSubaccount = ItemUtils.createItemSubaccount(targetContainerId);
                              var usedSpace = 0;
                              
                              for ((id, containerItem) in state.items.entries()) {
                                switch (containerItem.owner.subaccount) {
                                  case null { /* Not container owned */ };
                                  case (?itemSubaccount) {
                                    if (Blob.equal(itemSubaccount, containerSubaccount)) {
                                      // Add space used by this item
                                      switch (state.itemTypes.get(containerItem.type_id)) {
                                        case null { /* Skip invalid items */ };
                                        case (?containedItemType) {
                                          usedSpace += if (containedItemType.is_container) {
                                            switch (containedItemType.container_capacity) {
                                              case null { 1 }; // Treat as regular item if no capacity
                                              case (?cap) { cap };
                                            };
                                          } else {
                                            1
                                          };
                                        };
                                      };
                                    };
                                  };
                                };
                              };

                              if (usedSpace + spaceNeeded > targetCapacity) {
                                return #err("Not enough space in target container");
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

            // Handle partial stack transfers
            let (sourceCount, targetCount) = switch (transferCount) {
              case null { 
                // Transfer entire stack
                (0, item.count)
              };
              case (?count) {
                if (count == 0) {
                  return #err("Transfer count must be greater than 0");
                };
                if (count > item.count) {
                  return #err("Transfer count exceeds available items");
                };
                (item.count - count, count)
              };
            };

            // Update or delete source item
            if (sourceCount == 0) {
              state.items.delete(itemId);
            } else {
              let updatedSourceItem : Item = {
                id = item.id;
                type_id = item.type_id;
                is_open = item.is_open;
                owner = item.owner;
                count = sourceCount;
              };
              state.items.put(itemId, updatedSourceItem);
            };

            // Create new item for target if partial transfer
            if (targetCount < item.count) {
              let newItemId = state.stable_state.nextItemId;
              state.stable_state.nextItemId += 1;

              let newItem : Item = {
                id = newItemId;
                type_id = item.type_id;
                is_open = false;
                owner = newOwner;
                count = targetCount;
              };
              state.items.put(newItemId, newItem);

              // Log transfer event for new item
              logItemEvent(state, {
                id = state.stable_state.nextMessageId;
                timestamp = Time.now();
                kind = #Transfer;
                item_id = newItemId;
                from = ?item.owner;
                to = ?newOwner;
              });
              state.stable_state.nextMessageId += 1;
            } else {
              // Full transfer - update existing item
              let updatedItem : Item = {
                id = item.id;
                type_id = item.type_id;
                is_open = false; // Close container on transfer
                owner = newOwner;
                count = targetCount;
              };
              state.items.put(itemId, updatedItem);

              // Log transfer event
              logItemEvent(state, {
                id = state.stable_state.nextMessageId;
                timestamp = Time.now();
                kind = #Transfer;
                item_id = itemId;
                from = ?item.owner;
                to = ?newOwner;
              });
              state.stable_state.nextMessageId += 1;
            };

            #ok(())
          };
        }
      };
    }
  };

  // Delete an item
  public func deleteItem(
    state: MudState,
    caller: Principal,
    itemId: ItemId
  ) : Result.Result<(), Text> {
    switch (state.items.get(itemId)) {
      case null { #err("Item not found") };
      case (?item) {
        // Only realm owners can delete items
        if (not State.isRealmOwner(state, caller)) {
          return #err("Only realm owners can delete items");
        };

        // Check if this is a container and has items in it
        switch (state.itemTypes.get(item.type_id)) {
          case null { return #err("Item type not found") };
          case (?itemType) {
            if (itemType.is_container) {
              // Check if any items are owned by this container
              let containerSubaccount = ItemUtils.createItemSubaccount(itemId);
              for ((id, ownedItem) in state.items.entries()) {
                switch (ownedItem.owner.subaccount) {
                  case null { /* Not container owned */ };
                  case (?subaccount) {
                    if (Blob.equal(subaccount, containerSubaccount)) {
                      return #err("Cannot delete container with items inside");
                    };
                  };
                };
              };
            };

            // Log deletion event
            logItemEvent(state, {
              id = state.stable_state.nextMessageId;
              timestamp = Time.now();
              kind = #Burn;
              item_id = itemId;
              from = ?item.owner;
              to = null;
            });
            state.stable_state.nextMessageId += 1;

            state.items.delete(itemId);
            #ok(())
          };
        }
      };
    }
  };

  // Toggle container open/closed state
  public func toggleContainer(
    state: MudState,
    caller: Principal,
    containerId: ItemId
  ) : Result.Result<Bool, Text> {
    switch (state.items.get(containerId)) {
      case null { #err("Container not found") };
      case (?container) {
        // Check if caller can access the container
        if (not ItemUtils.canAccessItem(state, containerId, caller)) {
          return #err("You don't have access to this container");
        };

        // Verify it's actually a container
        switch (state.itemTypes.get(container.type_id)) {
          case null { #err("Item type not found") };
          case (?itemType) {
            if (not itemType.is_container) {
              return #err("This item is not a container");
            };

            let updatedContainer : Item = {
              id = container.id;
              type_id = container.type_id;
              is_open = not container.is_open;
              owner = container.owner;
              count = container.count;
            };
            state.items.put(containerId, updatedContainer);
            #ok(not container.is_open)
          };
        }
      };
    }
  };

  // Get items in a container
  public func getContainerContents(
    state: MudState,
    caller: Principal,
    containerId: ItemId
  ) : Result.Result<[ItemId], Text> {
    switch (state.items.get(containerId)) {
      case null { #err("Container not found") };
      case (?container) {
        // Check if caller can access the container
        if (not ItemUtils.canAccessItem(state, containerId, caller)) {
          return #err("You don't have access to this container");
        };

        // Verify it's actually a container
        switch (state.itemTypes.get(container.type_id)) {
          case null { #err("Item type not found") };
          case (?itemType) {
            if (not itemType.is_container) {
              return #err("This item is not a container");
            };

            if (not container.is_open) {
              return #err("Container is closed");
            };

            // Find all items owned by this container
            let containerSubaccount = ItemUtils.createItemSubaccount(containerId);
            let contents = Buffer.Buffer<ItemId>(0);
            
            for ((id, item) in state.items.entries()) {
              switch (item.owner.subaccount) {
                case null { /* Not container owned */ };
                case (?subaccount) {
                  if (Blob.equal(subaccount, containerSubaccount)) {
                    contents.add(id);
                  };
                };
              };
            };

            #ok(Buffer.toArray(contents))
          };
        }
      };
    }
  };

  // Check if a container has space for more items
  public func hasContainerSpace(
    state: MudState,
    containerId: ItemId
  ) : Result.Result<Bool, Text> {
    switch (state.items.get(containerId)) {
      case null { #err("Container not found") };
      case (?container) {
        // Verify it's actually a container
        switch (state.itemTypes.get(container.type_id)) {
          case null { #err("Item type not found") };
          case (?itemType) {
            if (not itemType.is_container) {
              return #err("This item is not a container");
            };

            switch (itemType.container_capacity) {
              case null { #ok(true) }; // No capacity limit
              case (?capacity) {
                // Count items in container
                let containerSubaccount = ItemUtils.createItemSubaccount(containerId);
                var itemCount = 0;
                
                for ((id, item) in state.items.entries()) {
                  switch (item.owner.subaccount) {
                    case null { /* Not container owned */ };
                    case (?subaccount) {
                      if (Blob.equal(subaccount, containerSubaccount)) {
                        itemCount += 1;
                      };
                    };
                  };
                };

                #ok(itemCount < capacity)
              };
            }
          };
        }
      };
    }
  };

  // Helper function to log item events
  private func logItemEvent(state: MudState, event: ItemEvent) {
    Debug.print("Item event: " # debug_show(event));
    // TODO: Implement proper event logging when needed
  };
} 