import React from 'react';
import MessagePart from './MessagePart';

const MessageLine = ({ message, onCommand }) => {
  // Handle legacy string messages during transition
  if (typeof message === 'string') {
    return (
      <div className="log-message message-info">
        <MessagePart part={{ type: 'text', content: message }} />
      </div>
    );
  }

  // Handle legacy object messages during transition
  if (!Array.isArray(message.parts)) {
    return (
      <div className={`log-message message-${message.type || 'info'}`}>
        <MessagePart 
          part={{ 
            type: 'text', 
            content: message.content,
            interactable: message.isInteractive ? {
              tooltip: message.tooltip,
              actions: { click: message.onClick }
            } : undefined
          }} 
        />
      </div>
    );
  }

  // Handle new structured messages
  return (
    <div className={`log-message message-${message.type || 'info'}`}>
      {message.parts.map((part, index) => (
        <MessagePart 
          key={index} 
          part={part}
          onCommand={onCommand}
        />
      ))}
    </div>
  );
};

export default MessageLine; 