import { useState } from 'react';

function RoomInterface({ onCommand, currentRoom }) {
  const [command, setCommand] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (command.trim()) {
      onCommand(command);
      setCommand('');
    }
  };

  return (
    <div className="room-interface">
      {currentRoom?.exits && currentRoom.exits.length > 0 && (
        <div className="available-exits">
          {currentRoom.exits.map(([exitId, exit]) => (
            <button
              key={exitId}
              className="exit-button"
              onClick={() => onCommand(`/go ${exit.name}`)}
            >
              {exit.name} {exit.direction ? `(${exit.direction})` : ''}
            </button>
          ))}
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="command-form">
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="Enter command..."
          className="command-input"
        />
        <button type="submit" className="command-button">
          Send
        </button>
      </form>
    </div>
  );
}

export default RoomInterface; 