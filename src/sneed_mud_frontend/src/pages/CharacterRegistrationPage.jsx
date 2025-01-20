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
  const [isRealmOwner, setIsRealmOwner] = useState(false);

  useEffect(() => {
    async function checkRealmOwner() {
      try {
        const ownerResult = await authenticatedActor.isRealmOwner(Principal.fromText(principal));
        setIsRealmOwner(ownerResult);
      } catch (error) {
        console.error("Error checking realm owner status:", error);
      }
    }

    if (authenticatedActor) {
      checkRealmOwner();
    }
  }, [authenticatedActor, principal]);

  useEffect(() => {
    async function loadCharacterClasses() {
      try {
        const result = await authenticatedActor.getAvailableCharacterClasses();
        if ('ok' in result) {
          setAvailableCharacterClasses(result.ok);
          // If realm owner and no classes exist, select God class
          if (isRealmOwner && result.ok.length === 0) {
            setSelectedCharacterClass("God");
          } else if (result.ok.length > 0) {
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
  }, [authenticatedActor, isRealmOwner]);

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

  if (availableCharacterClasses.length === 0 && !isRealmOwner) {
    return <div>No character classes available for registration. Please try again later.</div>;
  }

  return (
    <div className="registration-page">
      <div className="registration-container">
        <h2>Register Your Character</h2>
        <div className="principal-info" style={{
          marginBottom: '20px',
          padding: '10px',
          backgroundColor: '#f5f5f5',
          borderRadius: '4px'
        }}>
          <p style={{ margin: 0 }}>Your Principal ID: <code style={{
            backgroundColor: '#e0e0e0',
            padding: '2px 4px',
            borderRadius: '3px',
            fontFamily: 'monospace',
            wordBreak: 'break-all'
          }}>{principal}</code></p>
          {isRealmOwner && (
            <p style={{ margin: '10px 0 0 0', color: '#666' }}>
              You are a realm owner {availableCharacterClasses.length === 0 && "- You will be assigned the God class"}
            </p>
          )}
        </div>
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
            {isRealmOwner && availableCharacterClasses.length === 0 ? (
              <select
                id="characterClass"
                value="God"
                disabled
                required
              >
                <option value="God">God Class (Realm Owner)</option>
              </select>
            ) : (
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
            )}
          </div>

          {selectedCharacterClass && selectedCharacterClass !== "God" && (
            <div className="character-class-description">
              {availableCharacterClasses.find(characterClass => characterClass.name === selectedCharacterClass)?.description}
            </div>
          )}
          {selectedCharacterClass === "God" && (
            <div className="character-class-description">
              Special administrative class for realm owners with balanced stats. This class is only available when no other character classes exist.
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