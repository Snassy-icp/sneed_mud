import Option "mo:base/Option";
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Debug "mo:base/Debug";
import Time "mo:base/Time";
import Types "./Types";
import State "./State";
import ItemUtils "./ItemUtils";
import Lib "./lib";
import Result "mo:base/Result";
import Buffer "mo:base/Buffer";

module {
  type MudState = State.MudState;
  type RoomId = Types.RoomId;
  type ItemId = Types.ItemId;
  type Account = Types.Account;
  type Item = Types.Item;
  type ItemType = Types.ItemType;
  type ItemEvent = Types.ItemEvent;
  type ItemEventKind = Types.ItemEventKind;
  type ItemTypeId = Types.ItemTypeId;

  // Helper function to log item events
  private func logItemEvent(state: MudState, event: ItemEvent) {
    Debug.print("Item event: " # debug_show(event));
    
    switch (event.kind) {
      case (#Transfer) {
        // Get item details
        switch (state.items.get(event.item_id)) {
          case (?item) {
            switch (state.itemTypes.get(item.type_id)) {
              case (?itemType) {
                // Check if source is a room
                let isFromRoom = switch (event.from) {
                  case (?fromAccount) {
                    switch (fromAccount.subaccount) {
                      case (?subaccount) {
                        let ownerBytes = Blob.toArray(subaccount);
                        ownerBytes.size() > 1 and ownerBytes[1] == 1; // Type 1 is room ownership
                      };
                      case null { false };
                    };
                  };
                  case null { false };
                };

                // Check if target is a room
                let isToRoom = switch (event.to) {
                  case (?toAccount) {
                    switch (toAccount.subaccount) {
                      case (?subaccount) {
                        let ownerBytes = Blob.toArray(subaccount);
                        ownerBytes.size() > 1 and ownerBytes[1] == 1; // Type 1 is room ownership
                      };
                      case null { false };
                    };
                  };
                  case null { false };
                };

                // Check if target is a container
                let isToContainer = switch (event.to) {
                  case (?toAccount) {
                    switch (toAccount.subaccount) {
                      case (?subaccount) {
                        let ownerBytes = Blob.toArray(subaccount);
                        ownerBytes.size() > 1 and ownerBytes[1] == 2; // Type 2 is container ownership
                      };
                      case null { false };
                    };
                  };
                  case null { false };
                };

                // Get player names for messaging
                let sourcePlayerName = switch (event.from) {
                  case (?fromAccount) {
                    switch (fromAccount.subaccount) {
                      case null {
                        switch (state.players.get(fromAccount.owner)) {
                          case (?name) { ?name };
                          case null { null };
                        };
                      };
                      case _ { null };
                    };
                  };
                  case null { null };
                };

                let targetPlayerName = switch (event.to) {
                  case (?toAccount) {
                    switch (toAccount.subaccount) {
                      case null {
                        switch (state.players.get(toAccount.owner)) {
                          case (?name) { ?name };
                          case null { null };
                        };
                      };
                      case _ { null };
                    };
                  };
                  case null { null };
                };

                // Get room ID where this is happening
                let roomId = switch (event.from) {
                  case (?fromAccount) {
                    switch (fromAccount.subaccount) {
                      case (?subaccount) {
                        let ownerBytes = Blob.toArray(subaccount);
                        if (ownerBytes.size() > 1 and ownerBytes[1] == 1) {
                          // From room
                          ?ItemUtils.bytes_to_nat(Array.tabulate<Nat8>(
                            ownerBytes.size() - 2,
                            func(i) { ownerBytes[i + 2] }
                          ));
                        } else { null };
                      };
                      case null {
                        // From player inventory, get their room
                        switch (state.playerLocations.get(fromAccount.owner)) {
                          case (?location) { ?location };
                          case null { null };
                        };
                      };
                    };
                  };
                  case null { null };
                };

                // Handle different transfer scenarios
                switch (sourcePlayerName, targetPlayerName, isFromRoom, isToRoom, isToContainer) {
                  case (?fromName, ?toName, false, false, false) {
                    // Player to player (give) - public action
                    switch (event.from, event.to) {
                      case (?from, ?to) {
                        // Message to giver
                        Lib.addMessageToLog(state, from.owner, "You give " # itemType.name # " to " # toName);
                        // Message to receiver
                        Lib.addMessageToLog(state, to.owner, fromName # " gives you " # itemType.name);
                        // Message to others in room
                        do {
                          switch (roomId) {
                            case (?rid) {
                              State.broadcastToRoom(
                                state, 
                                rid, 
                                fromName # " gives " # itemType.name # " to " # toName,
                                [from.owner, to.owner]
                              );
                            };
                            case null {};
                          };
                        };
                      };
                      case _ {};
                    }
                  };
                  case (?fromName, null, false, true, false) {
                    // Player to room (drop) - public action
                    switch (event.from) {
                      case (?from) {
                        // Message to dropper
                        Lib.addMessageToLog(state, from.owner, "You drop " # itemType.name);
                        // Message to others in room
                        switch (roomId) {
                          case (?rid) {
                            State.broadcastToRoom(state, rid, fromName # " drops " # itemType.name, [from.owner]);
                          };
                          case null {};
                        };
                      };
                      case null {};
                    };
                  };
                  case (_, ?toName, true, false, false) {
                    // Room to player (pick/take) - public action
                    switch (event.to) {
                      case (?to) {
                        // Message to taker
                        Lib.addMessageToLog(state, to.owner, "You pick up " # itemType.name);
                        // Message to others in room
                        switch (roomId) {
                          case (?rid) {
                            State.broadcastToRoom(state, rid, toName # " picks up " # itemType.name, [to.owner]);
                          };
                          case null {};
                        };
                      };
                      case null {};
                    };
                  };
                  case (?fromName, null, false, false, true) {
                    // Player to container - private action
                    switch (event.from, event.to) {
                      case (?from, ?to) {
                        // Message only to the player performing the action
                        Lib.addMessageToLog(state, from.owner, "You put " # itemType.name # " into the container");
                      };
                      case _ {};
                    };
                  };
                  case (null, ?toName, false, false, true) {
                    // Container to player - private action
                    switch (event.to) {
                      case (?to) {
                        // Message only to the player performing the action
                        Lib.addMessageToLog(state, to.owner, "You take " # itemType.name # " from the container");
                      };
                      case _ {};
                    };
                  };
                  case (null, null, _, _, _) {
                    // Container to container or other system transfers - no messages needed
                  };
                  case _ {
                    // Other cases (shouldn't happen), no messages needed
                  };
                };
              };
              case null {};
            };
          };
          case null {};
        };
      };
      case (#Mint) {
        // No messages needed for item creation
      };
      case (#Burn) {
        // No messages needed for item deletion
      };
    };
  };

  // Helper function to broadcast to room except two principals
  private func broadcastToRoomExcept2(state: MudState, roomId: RoomId, exclude1: Principal, exclude2: Principal, content: Text) {
    for ((principal, location) in state.playerLocations.entries()) {
      if (location == roomId and principal != exclude1 and principal != exclude2) {
        Lib.addMessageToLog(state, principal, content);
      };
    };
  };

  // Create a new item type
  public func createItemType(
    state: MudState,
    caller: Principal,
    name: Text,
    description: Text,
    is_container: Bool,
    container_capacity: ?Nat,
    icon_url: Text,
    stack_max: Nat
  ) : Result.Result<ItemTypeId, Text> {
    // Check if caller is a realm owner
    if (not State.isRealmOwner(state, caller)) {
      return #err("Only realm owners can create item types");
    };

    // Validate stack_max
    if (stack_max == 0) {
      return #err("Stack max must be greater than 0");
    };

    // Validate container capacity if it's a container
    if (is_container) {
      switch (container_capacity) {
        case null { return #err("Container capacity must be specified for containers") };
        case (?cap) {
          if (cap == 0) {
            return #err("Container capacity must be greater than 0");
          };
        };
      };
    } else if (container_capacity != null) {
      return #err("Container capacity should only be specified for containers");
    };

    let typeId = state.stable_state.nextItemTypeId;
    state.stable_state.nextItemTypeId += 1;

    let newItemType : ItemType = {
      id = typeId;
      name = name;
      description = description;
      is_container = is_container;
      container_capacity = container_capacity;
      icon_url = icon_url;
      stack_max = stack_max;
    };

    state.itemTypes.put(typeId, newItemType);
    #ok(typeId)
  };

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
    Debug.print("Transfer initiated: " # debug_show({
      caller = caller;
      itemId = itemId;
      newOwner = newOwner;
      transferCount = transferCount;
    }));

    switch (state.items.get(itemId)) {
      case null { #err("Item not found") };
      case (?item) {
        Debug.print("Current item state: " # debug_show(item));
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

            // Create the from account using the item's current owner
            let fromAccount = item.owner;

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
            var targetItemId = itemId;
            if (targetCount < item.count) {
              let newItemId = state.stable_state.nextItemId;
              state.stable_state.nextItemId += 1;
              targetItemId := newItemId;

              let newItem : Item = {
                id = newItemId;
                type_id = item.type_id;
                is_open = false;
                owner = newOwner;
                count = targetCount;
              };
              state.items.put(newItemId, newItem);
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
            };

            // Log transfer event
            Debug.print("Logging transfer event: " # debug_show({
              from = ?fromAccount;
              to = ?newOwner;
            }));
            logItemEvent(state, {
              id = state.stable_state.nextMessageId;
              timestamp = Time.now();
              kind = #Transfer;
              item_id = targetItemId;
              from = ?fromAccount;
              to = ?newOwner;
            });
            state.stable_state.nextMessageId += 1;

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
    Debug.print("Getting contents for container: " # debug_show(containerId));
    
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
            Debug.print("Container subaccount: " # debug_show(Blob.toArray(containerSubaccount)));
            let contents = Buffer.Buffer<ItemId>(0);
            
            for ((id, item) in state.items.entries()) {
              switch (item.owner.subaccount) {
                case null { /* Not container owned */ };
                case (?subaccount) {
                  Debug.print("Checking item " # debug_show(id) # " with subaccount: " # debug_show(Blob.toArray(subaccount)));
                  if (Blob.equal(subaccount, containerSubaccount)) {
                    Debug.print("Found matching item: " # debug_show(id));
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
}; 
 
