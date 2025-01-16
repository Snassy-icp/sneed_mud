import { useEffect, useRef } from 'react';

const TextLog = ({ messages }) => {
  const logRef = useRef(null);
  console.log("TextLog rendering with messages:", messages.map(m => JSON.stringify(m)));

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="text-log" ref={logRef}>
        <div className="log-message">No messages yet...</div>
      </div>
    );
  }

  return (
    <div className="text-log" ref={logRef}>
      {messages.map((message, index) => (
        <div 
          key={index} 
          className="log-message"
        >
          {message}
        </div>
      ))}
    </div>
  );
};

export default TextLog; 