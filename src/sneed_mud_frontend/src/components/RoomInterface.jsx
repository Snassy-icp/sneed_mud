import { useState, useEffect } from 'react';

const RoomInterface = ({ onCommand, currentRoom }) => {
  const [command, setCommand] = useState('');
  const [commandHistory, setCommandHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (command.trim()) {
      onCommand(command.trim());
      // Add command to history
      setCommandHistory(prev => [...prev, command.trim()]);
      setHistoryIndex(-1);
      setCommand('');
    }
  };

  const handleKeyDown = (e) => {
    if (commandHistory.length === 0) return;

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const newIndex = historyIndex === -1 
        ? commandHistory.length - 1 
        : Math.max(0, historyIndex - 1);
      setHistoryIndex(newIndex);
      setCommand(commandHistory[newIndex]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex === -1) return;
      
      const newIndex = historyIndex + 1;
      if (newIndex >= commandHistory.length) {
        setHistoryIndex(-1);
        setCommand('');
      } else {
        setHistoryIndex(newIndex);
        setCommand(commandHistory[newIndex]);
      }
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
          onKeyDown={handleKeyDown}
          placeholder='Enter command... (Type /help or /? for available commands)'
          className="command-input"
        />
        <button type="submit" className="command-button">Send</button>
      </form>
    </div>
  );
};

export default RoomInterface; 