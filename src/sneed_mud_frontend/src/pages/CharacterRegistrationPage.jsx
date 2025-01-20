import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Principal } from '@dfinity/principal';

function CharacterRegistrationPage({ authenticatedActor, principal, onNameSet, onLogout }) {
  const [checkingName, setCheckingName] = useState(true);
  const [hasName, setHasName] = useState(false);
  const [registrationError, setRegistrationError] = useState(null);
  const [registrationSuccess, setRegistrationSuccess] = useState(null);
  const [availableClasses, setAvailableClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [loadingClasses, setLoadingClasses] = useState(true);

  useEffect(() => {
    async function loadClasses() {
      try {
        const result = await authenticatedActor.getAvailableClasses();
        if ('ok' in result) {
          setAvailableClasses(result.ok);
          if (result.ok.length > 0) {
            setSelectedClass(result.ok[0].name);
          }
        } else {
          setRegistrationError("Failed to load classes: " + result.err);
        }
      } catch (error) {
        setRegistrationError("Failed to load classes: " + error.message);
      }
      setLoadingClasses(false);
    }

    if (authenticatedActor) {
      loadClasses();
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
      const characterResult = await authenticatedActor.createCharacterWithClass(selectedClass);
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

  if (loadingClasses) {
    return <div>Loading available classes...</div>;
  }

  if (availableClasses.length === 0) {
    return <div>No classes available for registration. Please try again later.</div>;
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
            <label htmlFor="class">Choose Your Class:</label>
            <select
              id="class"
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              required
            >
              {availableClasses.map((classData) => (
                <option key={classData.name} value={classData.name}>
                  {classData.name}
                </option>
              ))}
            </select>
          </div>

          {selectedClass && (
            <div className="class-description">
              {availableClasses.find(c => c.name === selectedClass)?.description}
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