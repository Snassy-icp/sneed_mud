import { useState, useEffect } from 'react';

function RoomInterface({ onCommand, currentRoom }) {
  const [command, setCommand] = useState('');
  const [commandHistory, setCommandHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (command.trim()) {
      onCommand(command);
      setCommandHistory(prev => [...prev, command]);
      setHistoryIndex(-1);
      setCommand('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex = historyIndex + 1;
        if (newIndex < commandHistory.length) {
          setHistoryIndex(newIndex);
          setCommand(commandHistory[commandHistory.length - 1 - newIndex]);
        }
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setCommand(commandHistory[commandHistory.length - 1 - newIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setCommand('');
      }
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
          onKeyDown={handleKeyDown}
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