import Principal "mo:base/Principal";
import Result "mo:base/Result";
import Types "./Types";
import State "./State";
import Lib "./lib";

actor {
  type Room = Types.Room;
  type RoomId = Types.RoomId;
  type LogMessage = Types.LogMessage;
  type MessageId = Types.MessageId;

  private stable var stable_state : State.StableState = State.initStable();
  private var state : State.MudState = State.init(stable_state);

  system func preupgrade() {
    stable_state := State.preupgrade(state);
  };

  system func postupgrade() {
    state := State.init(stable_state);
  };

  public query(msg) func getMessages(afterId: ?MessageId) : async [LogMessage] {
    Lib.getMessages(state, msg.caller, afterId)
  };

  public query func test_getMessages(principal : Principal, afterId: ?MessageId) : async [LogMessage] {
    Lib.getMessages(state, principal, afterId)
  };

  public shared(msg) func createRoom(name: Text, description: Text) : async Result.Result<RoomId, Text> {
    Lib.createRoom(state, msg.caller, name, description)
  };

  public shared(msg) func updateRoom(roomId: RoomId, name: Text, description: Text) : async Result.Result<(), Text> {
    Lib.updateRoom(state, msg.caller, roomId, name, description)
  };

  public shared(msg) func updateExit(
    fromRoomId: RoomId,
    exitId: Text,
    name: Text,
    description: Text,
    targetRoomId: RoomId,
    direction: ?Text
  ) : async Result.Result<(), Text> {
    Lib.updateExit(state, msg.caller, fromRoomId, exitId, name, description, targetRoomId, direction)
  };

  public shared(msg) func addExit(
    fromRoomId: RoomId, 
    exitId: Text,
    name: Text, 
    description: Text, 
    targetRoomId: RoomId,
    direction: ?Text
  ) : async Result.Result<(), Text> {
    Lib.addExit(state, msg.caller, fromRoomId, exitId, name, description, targetRoomId, direction)
  };

  // Room ownership management
  public shared(msg) func addRoomOwner(roomId: RoomId, newOwner: Principal) : async Result.Result<(), Text> {
    Lib.addRoomOwner(state, msg.caller, roomId, newOwner)
  };

  public shared(msg) func removeRoomOwner(roomId: RoomId, ownerToRemove: Principal) : async Result.Result<(), Text> {
    Lib.removeRoomOwner(state, msg.caller, roomId, ownerToRemove)
  };

  // Realm management
  public query func getRealmInfo() : async Types.RealmConfig {
    state.realmConfig
  };

  public query func isRealmOwner(principal: Principal) : async Bool {
    State.isRealmOwner(state, principal)
  };

  public query func isRoomOwner(roomId: RoomId, principal: Principal) : async Bool {
    switch (state.rooms.get(roomId)) {
      case null { false };
      case (?room) { State.isRoomOwner(room, principal) };
    }
  };

  public query func getRoomOwners(roomId: RoomId) : async Result.Result<[Principal], Text> {
    switch (state.rooms.get(roomId)) {
      case null { #err("Room not found") };
      case (?room) { #ok(room.owners) };
    }
  };

  public query func getRoom(roomId: RoomId) : async ?Room {
    state.rooms.get(roomId)
  };

  public shared(msg) func registerPlayerName(name : Text) : async Result.Result<Text, Text> {
    Lib.registerPlayerName(state, msg.caller, name)
  };

  public query func getPlayerName(principal : Principal) : async ?Text {
    state.players.get(principal)
  };

  public query func isNameTaken(name : Text) : async Bool {
    switch (state.usedNames.get(name)) {
      case (?_principal) { true };
      case null { false };
    }
  };

  public func clearAllPlayers() : async () {
    for ((principal, _) in state.players.entries()) {
      Lib.clearPlayer(state, principal);
    };
  };

  public query(msg) func getCurrentRoom() : async Result.Result<Room, Text> {
    Lib.getCurrentRoom(state, msg.caller)
  };

  public shared(msg) func useExit(exitId: Text) : async Result.Result<Room, Text> {
    Lib.useExit(state, msg.caller, exitId)
  };

  public shared(msg) func test_useExit(principal : Principal, exitId: Text) : async Result.Result<Room, Text> {
    Lib.useExit(state, principal, exitId)
  };

  public shared(msg) func getPlayersInRoom(roomId: RoomId) : async Result.Result<[(Principal, Text)], Text> {
    Lib.getPlayersInRoom(state, roomId)
  };

  public shared(msg) func clearPlayer(principal: Principal) : async () {
    Lib.clearPlayer(state, principal)
  };

  public shared(msg) func say(message: Text) : async Result.Result<(), Text> {
    Lib.say(state, msg.caller, message)
  };

  public shared(msg) func whisper(targetName: Text, message: Text) : async Result.Result<(), Text> {
    Lib.whisper(state, msg.caller, targetName, message)
  };

  // Realm management
  public shared(msg) func addRealmOwner(newOwner: Principal) : async Result.Result<(), Text> {
    Lib.addRealmOwner(state, msg.caller, newOwner)
  };

  public shared(msg) func removeRealmOwner(ownerToRemove: Principal) : async Result.Result<(), Text> {
    Lib.removeRealmOwner(state, msg.caller, ownerToRemove)
  };

  public shared(msg) func updateRealmInfo(name: Text, description: Text) : async Result.Result<(), Text> {
    Lib.updateRealmInfo(state, msg.caller, name, description)
  };

  // Room ownership queries
  public query func getOwnedRooms(principal: Principal) : async [(RoomId, Room)] {
    Lib.getOwnedRooms(state, principal)
  };
}
