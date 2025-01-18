import { useState } from 'react';
import { Navigate } from 'react-router-dom';

function CharacterRegistrationPage({ isAuthenticated, playerName, authenticatedActor, setPlayerName }) {
  const [registrationError, setRegistrationError] = useState(null);
  const [registrationSuccess, setRegistrationSuccess] = useState(null);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (playerName) {
    return <Navigate to="/game" replace />;
  }

  async function handleNameRegistration(event) {
    event.preventDefault();
    setRegistrationError(null);
    setRegistrationSuccess(null);

    const name = event.target.elements.playerName.value;
    try {
      const result = await authenticatedActor.registerPlayerName(name);
      if ('ok' in result) {
        setRegistrationSuccess(result.ok);
        setPlayerName(name);
      } else if ('err' in result) {
        setRegistrationError(result.err);
      }
    } catch (error) {
      setRegistrationError("Failed to register name: " + error.message);
    }
  }

  return (
    <div className="registration-page">
      <div className="registration-container">
        <h2>Register Your Character Name</h2>
        <form onSubmit={handleNameRegistration}>
          <input
            type="text"
            id="playerName"
            name="playerName"
            placeholder="Enter your character name"
            maxLength="20"
            required
          />
          <button type="submit">Register Name</button>
        </form>
        {registrationError && (
          <div className="error">{registrationError}</div>
        )}
        {registrationSuccess && (
          <div className="success">{registrationSuccess}</div>
        )}
      </div>
    </div>
  );
}

export default CharacterRegistrationPage; 