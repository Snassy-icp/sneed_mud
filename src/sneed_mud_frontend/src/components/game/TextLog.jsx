function TextLog({ messages }) {
  return (
    <div className="text-log">
      {messages.map((message, index) => (
        <div key={index} className="log-message">
          {message}
        </div>
      ))}
    </div>
  );
}

export default TextLog; 