import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.scss';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);


//});
/*
const init = async () => {
  const authClient = await AuthClient.create();
  if (await authClient.isAuthenticated()) {
    // User is already authenticated
    handleAuthenticated(authClient);
  }
};

function handleAuthenticated(authClient) {
  alert("authenticated");
}

init();
*/