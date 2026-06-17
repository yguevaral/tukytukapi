const test = require('node:test');
const assert = require('node:assert/strict');

const { verifyGoogleIdToken } = require('../helpers/google-auth');

test('verifyGoogleIdToken rechaza idToken vacío', async () => {
    await assert.rejects(
        () => verifyGoogleIdToken('', 'fake-client-id'),
        /idToken requerido/
    );
});

test('verifyGoogleIdToken rechaza si no hay clientId configurado', async () => {
    await assert.rejects(
        () => verifyGoogleIdToken('algo', ''),
        /GOOGLE_OAUTH_CLIENT_ID/
    );
});
