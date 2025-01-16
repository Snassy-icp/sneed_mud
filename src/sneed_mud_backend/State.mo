import Principal "mo:base/Principal";
import HashMap "mo:base/HashMap";
import Text "mo:base/Text";
import Nat "mo:base/Nat";
import Hash "mo:base/Hash";
import Array "mo:base/Array";
import Iter "mo:base/Iter";
import Buffer "mo:base/Buffer";
import Types "./Types";
import BufferUtils "./BufferUtils";

module {
  type Room = Types.Room;
  type RoomId = Types.RoomId;
  type Exit = Types.Exit;
  type LogMessage = Types.LogMessage;
  type MessageId = Types.MessageId;
  type CircularBuffer<T> = Types.CircularBuffer<T>;

  public type StableState = {
    var playerEntries : [(Principal, Text)];
    var roomEntries : [(RoomId, Room)];
    var playerLocationEntries : [(Principal, RoomId)];
    var messageLogEntries : [(Principal, [LogMessage])];
    var nextRoomId : Nat;
    var nextMessageId : MessageId;
  };

  public type MudState = {
    stable_state : StableState;
    var players : HashMap.HashMap<Principal, Text>;
    var usedNames : HashMap.HashMap<Text, Principal>;
    var rooms : HashMap.HashMap<RoomId, Room>;
    var playerLocations : HashMap.HashMap<Principal, RoomId>;
    var messageLogs : HashMap.HashMap<Principal, CircularBuffer<LogMessage>>;
  };

  public func initStable() : StableState {
    {
      var playerEntries = [];
      var roomEntries = [];
      var playerLocationEntries = [];
      var messageLogEntries = [];
      var nextRoomId = 0;
      var nextMessageId = 0;
    }
  };

  public func init(stable_state : StableState) : MudState {
    let state = {
      stable_state = stable_state;
      var players = HashMap.fromIter<Principal, Text>(
        stable_state.playerEntries.vals(), 
        100, 
        Principal.equal, 
        Principal.hash
      );
      var usedNames = HashMap.fromIter<Text, Principal>(
        Array.map<(Principal, Text), (Text, Principal)>(
          stable_state.playerEntries,
          func ((p, n) : (Principal, Text)) : (Text, Principal) = (n, p)
        ).vals(),
        100,
        Text.equal,
        Text.hash
      );
      var rooms = HashMap.fromIter<RoomId, Room>(
        stable_state.roomEntries.vals(), 
        100, 
        Nat.equal, 
        Hash.hash
      );
      var playerLocations = HashMap.fromIter<Principal, RoomId>(
        stable_state.playerLocationEntries.vals(), 
        100, 
        Principal.equal, 
        Principal.hash
      );
      var messageLogs = HashMap.HashMap<Principal, CircularBuffer<LogMessage>>(
        100, 
        Principal.equal, 
        Principal.hash
      );
    };

    // Initialize message logs from stable storage
    for ((principal, messages) in stable_state.messageLogEntries.vals()) {
      let cb = BufferUtils.createCircularBuffer<LogMessage>();
      for (msg in messages.vals()) {
        BufferUtils.addToCircularBuffer(cb, msg);
      };
      state.messageLogs.put(principal, cb);
    };

    state
  };

  public func preupgrade(state : MudState) : StableState {
    let playerBuffer = Buffer.Buffer<(Principal, Text)>(state.players.size());
    for ((p, t) in state.players.entries()) {
      playerBuffer.add((p, t));
    };

    let roomBuffer = Buffer.Buffer<(RoomId, Room)>(state.rooms.size());
    for ((id, room) in state.rooms.entries()) {
      roomBuffer.add((id, room));
    };

    let locationBuffer = Buffer.Buffer<(Principal, RoomId)>(state.playerLocations.size());
    for ((p, r) in state.playerLocations.entries()) {
      locationBuffer.add((p, r));
    };

    let messageBuffer = Buffer.Buffer<(Principal, [LogMessage])>(state.messageLogs.size());
    for ((p, cb) in state.messageLogs.entries()) {
      messageBuffer.add((p, BufferUtils.getFromCircularBuffer(cb, 0, cb.size)));
    };

    state.stable_state.playerEntries := Buffer.toArray(playerBuffer);
    state.stable_state.roomEntries := Buffer.toArray(roomBuffer);
    state.stable_state.playerLocationEntries := Buffer.toArray(locationBuffer);
    state.stable_state.messageLogEntries := Buffer.toArray(messageBuffer);
    
    state.stable_state
  };
} 