import { useEffect, useRef } from 'react';
import MessageLine from './MessageLine';

const TextLog = ({ messages, onCommand }) => {
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="text-log" ref={logRef}>
        <MessageLine 
          message={{ content: 'No messages yet...', type: 'system' }}
          onCommand={onCommand}
        />
      </div>
    );
  }

  return (
    <div className="text-log" ref={logRef}>
      {messages.map((message, index) => (
        <MessageLine 
          key={index} 
          message={message}
          onCommand={onCommand}
        />
      ))}
    </div>
  );
};

export default TextLog; 