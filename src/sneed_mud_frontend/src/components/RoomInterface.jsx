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

  return (
    <div className="room-interface">
      <div className="available-exits">
        {currentRoom?.exits?.map(([exitId, exit]) => (
          <button 
            key={exitId}
            className="exit-button"
            onClick={() => onCommand(`go ${exitId}`)}
          >
            {exit.name}
          </button>
        ))}
      </div>
      <form onSubmit={handleSubmit} className="command-form">
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="Enter command..."
          className="command-input"
        />
        <button type="submit" className="command-button">Send</button>
      </form>
    </div>
  );
};

export default RoomInterface; 