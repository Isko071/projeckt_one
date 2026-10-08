// Проверка Google/Firebase ID-токена без service account: подпись по публичным ключам Google, издатель и аудитория — наш проект.
// Для локальных тестов INSECURE_AUTH=1 принимает токен вида "test:<uid>".
const { createRemoteJWKSet, jwtVerify } = require('jose');

function makeVerifier(opts) {
  const projectId = opts.projectId;
  if (opts.insecure) {
    return async (token) => {
      const m = /^test:([A-Za-z0-9_-]{1,64})$/.exec(String(token || ''));
      if (!m) throw new Error('bad-token');
      return { uid: m[1], email: m[1] + '@test', emailVerified: true };
    };
  }
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is required');
  const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
  return async (token) => {
    const { payload } = await jwtVerify(String(token || ''), jwks, { issuer: 'https://securetoken.google.com/' + projectId, audience: projectId });
    if (!payload.sub) throw new Error('no-sub');
    return { uid: String(payload.sub), email: String(payload.email || '').toLowerCase(), emailVerified: payload.email_verified === true };
  };
}

module.exports = { makeVerifier };
