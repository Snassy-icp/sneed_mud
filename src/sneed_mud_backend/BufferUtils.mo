import Buffer "mo:base/Buffer";
import Types "./Types";

module {
  type LogMessage = Types.LogMessage;
  type MessageId = Types.MessageId;
  type CircularBuffer = Types.CircularBuffer;

  public func createCircularBuffer() : CircularBuffer {
    {
      var buffer = Buffer.Buffer<LogMessage>(100); // Fixed capacity of 100
      var start = 0;
      var size = 0;
      var capacity = 100;
      var highestId = null;
    }
  };

  public func addToCircularBuffer(cb: CircularBuffer, msg: LogMessage) {
    if (cb.size == cb.capacity) {
      // Buffer is full, remove oldest item
      cb.start := (cb.start + 1) % cb.capacity;
    } else {
      cb.size += 1;
    };

    // Calculate the position to insert the new item
    let insertPos = (cb.start + cb.size - 1) % cb.capacity;
    
    // Ensure buffer has enough capacity
    if (cb.buffer.size() <= insertPos) {
      cb.buffer.add(msg);
    } else {
      cb.buffer.put(insertPos, msg);
    };

    // Update highestId
    cb.highestId := ?msg.id;
  };

  public func getFromCircularBuffer(cb: CircularBuffer, start: Nat, count: Nat) : [LogMessage] {
    let result = Buffer.Buffer<LogMessage>(count);
    var i = 0;
    while (i < count and i < cb.size) {
      let pos = (cb.start + i) % cb.capacity;
      if (pos < cb.buffer.size()) {
        result.add(cb.buffer.get(pos));
      };
      i += 1;
    };
    Buffer.toArray(result)
  };

  public func getLastNFromCircularBuffer(cb: CircularBuffer, n: Nat) : [LogMessage] {
    let count = if (n > cb.size) { cb.size } else { n };
    let start = cb.size - count;
    getFromCircularBuffer(cb, start, count)
  };
} 