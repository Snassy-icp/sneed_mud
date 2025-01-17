import { useState } from 'react';

const RoomInterface = ({ onCommand, currentRoom }) => {
  const [command, setCommand] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (command.trim()) {
      onCommand(command.trim());
      setCommand('');
    }
  };

  console.log("Current room exits:", currentRoom?.exits);

  return (
    <div className="room-interface">
      <div className="available-exits">
        {currentRoom?.exits?.map(([exitId, exit]) => {
          console.log("Rendering exit:", { exitId, name: exit.name });
          return (
            <button 
              key={exitId}
              className="exit-button"
              onClick={() => {
                console.log("Clicked exit with ID:", exitId);
                onCommand(`/go ${exitId}`);
              }}
            >
              {exit.name}
            </button>
          );
        })}
      </div>
      <form onSubmit={handleSubmit} className="command-form">
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder='Enter command... (/say, /whisper, /go, /create_room, /create_exit, /create_item_type "name", "desc", is_container, capacity, "icon", stack_max, /create_item type_id[, count], /move_item item_id, container_id[, count], /open id, /close id)'
          className="command-input"
        />
        <button type="submit" className="command-button">Send</button>
      </form>
    </div>
  );
};

export default RoomInterface; 