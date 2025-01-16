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
    Lib.createRoom(state, name, description)
  };

  public shared(msg) func addExit(
    fromRoomId: RoomId, 
    exitId: Text,
    name: Text, 
    description: Text, 
    targetRoomId: RoomId,
    direction: ?Text
  ) : async Result.Result<(), Text> {
    Lib.addExit(state, fromRoomId, exitId, name, description, targetRoomId, direction)
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
}
