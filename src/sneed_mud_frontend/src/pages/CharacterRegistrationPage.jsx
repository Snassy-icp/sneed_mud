import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Principal } from '@dfinity/principal';

function CharacterRegistrationPage({ authenticatedActor, principal, onNameSet, onLogout }) {
  const [checkingName, setCheckingName] = useState(true);
  const [hasName, setHasName] = useState(false);
  const [registrationError, setRegistrationError] = useState(null);
  const [registrationSuccess, setRegistrationSuccess] = useState(null);
  const [availableCharacterClasses, setAvailableCharacterClasses] = useState([]);
  const [selectedCharacterClass, setSelectedCharacterClass] = useState('');
  const [loadingCharacterClasses, setLoadingCharacterClasses] = useState(true);

  useEffect(() => {
    async function loadCharacterClasses() {
      try {
        const result = await authenticatedActor.getAvailableCharacterClasses();
        if ('ok' in result) {
          setAvailableCharacterClasses(result.ok);
          if (result.ok.length > 0) {
            setSelectedCharacterClass(result.ok[0].name);
          }
        } else {
          setRegistrationError("Failed to load character classes: " + result.err);
        }
      } catch (error) {
        setRegistrationError("Failed to load character classes: " + error.message);
      }
      setLoadingCharacterClasses(false);
    }

    if (authenticatedActor) {
      loadCharacterClasses();
    }
  }, [authenticatedActor]);

  async function handleRegistration(event) {
    event.preventDefault();
    setRegistrationError(null);
    setRegistrationSuccess(null);

    const name = event.target.elements.playerName.value;

    try {
      // First register the name
      const nameResult = await authenticatedActor.registerPlayerName(name);
      if ('err' in nameResult) {
        setRegistrationError(nameResult.err);
        return;
      }

      // Then create character with selected class
      const characterResult = await authenticatedActor.createCharacterWithClass(selectedCharacterClass);
      if ('err' in characterResult) {
        setRegistrationError(characterResult.err);
        // Try to revert name registration if character creation fails
        await authenticatedActor.unregisterPlayerName();
        return;
      }

      setRegistrationSuccess(nameResult.ok);
      onNameSet(name);
    } catch (error) {
      setRegistrationError("Failed to register: " + error.message);
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

  if (loadingCharacterClasses) {
    return <div>Loading available character classes...</div>;
  }

  if (availableCharacterClasses.length === 0) {
    return <div>No character classes available for registration. Please try again later.</div>;
  }

  return (
    <div className="registration-page">
      <div className="registration-container">
        <h2>Register Your Character</h2>
        <form onSubmit={handleRegistration}>
          <div className="form-group">
            <label htmlFor="playerName">Character Name:</label>
            <input
              type="text"
              id="playerName"
              name="playerName"
              placeholder="Enter your character name"
              maxLength="20"
              required
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="characterClass">Choose Your Character Class:</label>
            <select
              id="characterClass"
              value={selectedCharacterClass}
              onChange={(e) => setSelectedCharacterClass(e.target.value)}
              required
            >
              <option value="">Select a character class</option>
              {availableCharacterClasses.map((characterClass) => (
                <option key={characterClass.name} value={characterClass.name}>
                  {characterClass.name}
                </option>
              ))}
            </select>
          </div>

          {selectedCharacterClass && (
            <div className="character-class-description">
              {availableCharacterClasses.find(characterClass => characterClass.name === selectedCharacterClass)?.description}
            </div>
          )}

          <button type="submit">Create Character</button>
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