import Array "mo:base/Array";
import Buffer "mo:base/Buffer";
import Types "./Types";

module {
  type CircularBuffer<T> = Types.CircularBuffer<T>;
  let MESSAGE_BUFFER_SIZE = 1000;

  public func createCircularBuffer<T>() : CircularBuffer<T> {
    {
      var buffer = Array.init<?T>(MESSAGE_BUFFER_SIZE, null);
      var start = 0;
      var size = 0;
      var highestId = null;
    }
  };

  public func addToCircularBuffer<T>(cb: CircularBuffer<T>, value: T) {
    let index = (cb.start + cb.size) % MESSAGE_BUFFER_SIZE;
    cb.buffer[index] := ?value;
    
    if (cb.size < MESSAGE_BUFFER_SIZE) {
      cb.size += 1;
    } else {
      cb.start := (cb.start + 1) % MESSAGE_BUFFER_SIZE;
    };
  };

  public func getFromCircularBuffer<T>(cb: CircularBuffer<T>, startIndex: Nat, count: Nat) : [T] {
    let result = Buffer.Buffer<T>(count);
    var i = 0;
    while (i < count and i < cb.size) {
      let index = (cb.start + i) % MESSAGE_BUFFER_SIZE;
      switch (cb.buffer[index]) {
        case (?value) { result.add(value); };
        case null {};
      };
      i += 1;
    };
    Buffer.toArray(result)
  };

  public func getLastNFromCircularBuffer<T>(cb: CircularBuffer<T>, n: Nat) : [T] {
    let count = if (cb.size < n) { cb.size } else { n };
    let startIndex = cb.size - count;
    getFromCircularBuffer(cb, startIndex, count)
  };
} 