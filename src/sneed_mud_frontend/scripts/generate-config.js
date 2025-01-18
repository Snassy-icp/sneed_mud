import fs from 'fs';

const environment = process.env.VITE_ENVIRONMENT;
const backendCanisterId = process.env.CANISTER_ID_SNEED_MUD_BACKEND;

const config = {
  environment,
  backendCanisterId,
  dfxNetwork: 'ic'
};

const configJson = JSON.stringify(config, null, 2);
fs.writeFileSync('src/sneed_mud_frontend/src/config.json', configJson); 