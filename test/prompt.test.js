import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDesignPrompt } from '../src/worker/prompt.js';
import { roomIdFromImageKey } from '../src/services/storage-service.js';

test('design prompt carries all preservation and design inputs', () => {
  const prompt = buildDesignPrompt({
    style: 'Scandinavian',
    palette: ['sage', 'oak'],
    preserve_items: ['windows', 'floor'],
    instructions: 'Use a compact sofa.',
  }, {
    roomTypeEstimate: 'living room',
    fixedElements: ['window on north wall'],
    architecture: ['high ceiling'],
    spatialNotes: ['narrow circulation path'],
    preservationRisks: ['do not cover the door'],
  });
  assert.match(prompt, /Strictly preserve the original camera viewpoint/);
  assert.match(prompt, /Scandinavian/);
  assert.match(prompt, /sage, oak/);
  assert.match(prompt, /window on north wall/);
  assert.match(prompt, /<brief>Use a compact sofa.<\/brief>/);
});

test('room image keys are bound to the authenticated owner', () => {
  const user = `user_${'a'.repeat(32)}`;
  const room = `room_${'b'.repeat(32)}`;
  assert.equal(roomIdFromImageKey(user, `rooms/${user}/${room}/original.jpg`), room);
  assert.equal(roomIdFromImageKey(`user_${'c'.repeat(32)}`, `rooms/${user}/${room}/original.jpg`), undefined);
  assert.equal(roomIdFromImageKey(user, `rooms/${user}/../../secret.jpg`), undefined);
});

