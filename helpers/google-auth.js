const { OAuth2Client } = require('google-auth-library');

const buildClient = (clientId) => new OAuth2Client(clientId);

/**
 * Valida un idToken de Google y devuelve el payload.
 * Lanza Error si el token es inválido o el `aud` no coincide.
 */
const verifyGoogleIdToken = async (idToken, clientId = process.env.GOOGLE_OAUTH_CLIENT_ID) => {
    if (!idToken) throw new Error('idToken requerido');
    if (!clientId) throw new Error('GOOGLE_OAUTH_CLIENT_ID no configurado');

    const client = buildClient(clientId);
    const ticket = await client.verifyIdToken({
        idToken,
        audience: clientId
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
        throw new Error('Token de Google no contiene email');
    }
    return {
        email: payload.email,
        name: payload.name || '',
        familyName: payload.family_name || '',
        givenName: payload.given_name || '',
        googleId: payload.sub,
        picture: payload.picture || '',
    };
};

module.exports = { verifyGoogleIdToken };
