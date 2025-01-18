import { useEffect, useRef } from 'react';

function TextLog({ messages }) {
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="text-log" ref={logRef}>
      {messages.map((message, index) => (
        <div key={index} className="log-message">
          {message}
        </div>
      ))}
    </div>
  );
}

export default TextLog; 