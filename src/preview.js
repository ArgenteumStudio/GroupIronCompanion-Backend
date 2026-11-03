import { randomBytes } from 'node:crypto';
import { createBridge } from './bridge.js';
import { createWorldMap } from './worldMap.js';

// No real member data or Discord connection is used by this local design preview.
const store = {
  state: { members: {}, activity: [], outbox: [] },
  icons() { return {}; },
  snapshot() { throw new Error('Preview is read-only'); },
  event() { throw new Error('Preview is read-only'); },
};
const server = createBridge({
  store,
  members: [{ name: 'Preview', token: randomBytes(32).toString('hex') }],
  worldMap: createWorldMap(),
});
server.listen(4173, '127.0.0.1', () => console.log('Private design preview: http://127.0.0.1:4173'));
server.on('error', error => {
  console.error('Preview failed:', error);
  process.exitCode = 1;
});
