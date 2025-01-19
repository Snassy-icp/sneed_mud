import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Principal } from '@dfinity/principal';

function CharacterRegistrationPage({ authenticatedActor, principal, onNameSet, onLogout }) {
  const [checkingName, setCheckingName] = useState(true);
  const [hasName, setHasName] = useState(false);
  const [registrationError, setRegistrationError] = useState(null);
  const [registrationSuccess, setRegistrationSuccess] = useState(null);

  async function handleNameRegistration(event) {
    event.preventDefault();
    setRegistrationError(null);
    setRegistrationSuccess(null);

    const name = event.target.elements.playerName.value;
    try {
      const result = await authenticatedActor.registerPlayerName(name);
      if ('ok' in result) {
        setRegistrationSuccess(result.ok);
        onNameSet(name);
      } else if ('err' in result) {
        setRegistrationError(result.err);
      }
    } catch (error) {
      setRegistrationError("Failed to register name: " + error.message);
    }
  }

  useEffect(() => {
    async function checkName() {
      try {
        const principalObj = Principal.fromText(principal);
        const nameOpt = await authenticatedActor.getPlayerName(principalObj);
        if (Array.isArray(nameOpt) && nameOpt.length > 0) {
          setHasName(true);
          onNameSet(nameOpt[0]);
        }
      } catch (error) {
        console.error("Error checking name:", error);
      }
      setCheckingName(false);
    }
    if (principal) {
      checkName();
    }
  }, [principal, authenticatedActor, onNameSet]);

  if (!principal) {
    return <Navigate to="/" replace />;
  }

  if (checkingName) {
    return <div>Checking registration status...</div>;
  }

  if (hasName) {
    return <Navigate to="/game" replace />;
  }

  if (registrationSuccess) {
    return <Navigate to="/game" replace />;
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