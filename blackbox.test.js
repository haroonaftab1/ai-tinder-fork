================================================================
  JEST + SUPERTEST BLACK BOX TESTS — TINDER BACKEND API
  (Work in progress — requires mongodb-memory-server to run)
================================================================

SETUP REQUIRED:
  npm install --save-dev mongodb-memory-server

================================================================
FILE: jest.config.js
================================================================

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['./tests/jestSetupEnv.js'],
  testTimeout: 30000,
};


================================================================
FILE: tests/jestSetupEnv.js
================================================================

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.JWT_SECRET = 'test-jwt-secret-key';
process.env.JWT_EXPIRES_IN = '1h';
process.env.BCRYPT_ROUNDS = '1';
process.env.SUPER_LIKE_DAILY_LIMIT = '1';
process.env.SUPER_LIKE_RESET_HOUR = '0';
process.env.MONGODB_URI = 'mongodb://localhost/test';


================================================================
FILE: config/__mocks__/database.js
================================================================

const connectDB = jest.fn().mockResolvedValue(undefined);
module.exports = { connectDB };


================================================================
FILE: config/__mocks__/redis.js
================================================================

const store = new Map();

const mockClient = {
  get: jest.fn(async (key) => store.get(key) ?? null),
  setEx: jest.fn(async (key, ttl, val) => { store.set(key, String(val)); return 'OK'; }),
  del: jest.fn(async (...keys) => {
    keys.flat().forEach(k => store.delete(k));
    return 1;
  }),
  incr: jest.fn(async (key) => {
    const val = (parseInt(store.get(key)) || 0) + 1;
    store.set(key, String(val));
    return val;
  }),
  expire: jest.fn(async () => 1),
  sMembers: jest.fn(async () => []),
  sAdd: jest.fn(async () => 1),
  sRem: jest.fn(async () => 1),
  zAdd: jest.fn(async () => 1),
};

const connectRedis = jest.fn().mockResolvedValue(undefined);
const getRedisClient = jest.fn(() => mockClient);
const __resetStore = () => store.clear();

module.exports = { connectRedis, getRedisClient, __resetStore, mockClient };


================================================================
FILE: tests/helpers/dbSetup.js
================================================================

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongoServer;

const connect = async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
};

const disconnect = async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongoServer.stop();
};

const clearCollections = async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
};

module.exports = { connect, disconnect, clearCollections };


================================================================
FILE: tests/health.test.js
================================================================

jest.mock('../config/database');
jest.mock('../config/redis');

const request = require('supertest');
const app = require('../server');

describe('GET /health', () => {
  it('200 - returns status OK', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
    expect(res.body.timestamp).toBeDefined();
  });
});


================================================================
FILE: tests/auth.test.js
================================================================

jest.mock('../config/database');
jest.mock('../config/redis');

const request = require('supertest');
const app = require('../server');
const { connect, disconnect, clearCollections } = require('./helpers/dbSetup');
const { __resetStore } = require('../config/redis');

const BASE = '/api/auth';

const validUser = {
  email: 'alice@test.com',
  password: 'Password1',
  name: 'Alice',
  age: 25,
  location: 'New York',
};

beforeAll(() => connect());
afterAll(() => disconnect());
afterEach(async () => {
  await clearCollections();
  __resetStore();
});

// ── REGISTER ──────────────────────────────────────────────────

describe('POST /api/auth/register', () => {
  it('201 - registers with valid payload', async () => {
    const res = await request(app).post(`${BASE}/register`).send(validUser);
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.message).toBe('User registered successfully');
  });

  it('201 - does NOT return password in response', async () => {
    const res = await request(app).post(`${BASE}/register`).send(validUser);
    expect(res.body.user.password).toBeUndefined();
  });

  it('201 - accepts all optional fields', async () => {
    const res = await request(app).post(`${BASE}/register`).send({
      ...validUser,
      email: 'full@test.com',
      gender: 'male',
      bio: 'Hello world',
      job: 'Engineer',
      tags: ['hiking', 'movies'],
      interestedIn: ['female'],
    });
    expect(res.status).toBe(201);
  });

  it('400 - rejects duplicate email', async () => {
    await request(app).post(`${BASE}/register`).send(validUser);
    const res = await request(app).post(`${BASE}/register`).send(validUser);
    expect(res.status).toBe(400);
  });

  it('400 - rejects missing email', async () => {
    const { email, ...rest } = validUser;
    const res = await request(app).post(`${BASE}/register`).send(rest);
    expect(res.status).toBe(400);
  });

  it('400 - rejects invalid email format', async () => {
    const res = await request(app).post(`${BASE}/register`).send({ ...validUser, email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  it('400 - rejects age under 18', async () => {
    const res = await request(app).post(`${BASE}/register`).send({ ...validUser, email: 'u@t.com', age: 17 });
    expect(res.status).toBe(400);
  });

  it('400 - rejects age over 100', async () => {
    const res = await request(app).post(`${BASE}/register`).send({ ...validUser, email: 'u@t.com', age: 101 });
    expect(res.status).toBe(400);
  });

  it('400 - rejects password shorter than 8 characters', async () => {
    const res = await request(app).post(`${BASE}/register`).send({ ...validUser, email: 'u@t.com', password: 'Pass1' });
    expect(res.status).toBe(400);
  });

  it('400 - rejects password with no uppercase letter', async () => {
    const res = await request(app).post(`${BASE}/register`).send({ ...validUser, email: 'u@t.com', password: 'password1' });
    expect(res.status).toBe(400);
  });

  it('400 - rejects password with no number', async () => {
    const res = await request(app).post(`${BASE}/register`).send({ ...validUser, email: 'u@t.com', password: 'Password' });
    expect(res.status).toBe(400);
  });

  it('400 - rejects name shorter than 2 characters', async () => {
    const res = await request(app).post(`${BASE}/register`).send({ ...validUser, email: 'u@t.com', name: 'A' });
    expect(res.status).toBe(400);
  });

  it('400 - rejects name longer than 50 characters', async () => {
    const res = await request(app).post(`${BASE}/register`).send({ ...validUser, email: 'u@t.com', name: 'A'.repeat(51) });
    expect(res.status).toBe(400);
  });

  it('400 - rejects missing name', async () => {
    const { name, ...rest } = validUser;
    const res = await request(app).post(`${BASE}/register`).send({ ...rest, email: 'u@t.com' });
    expect(res.status).toBe(400);
  });

  it('400 - rejects missing location', async () => {
    const { location, ...rest } = validUser;
    const res = await request(app).post(`${BASE}/register`).send({ ...rest, email: 'u@t.com' });
    expect(res.status).toBe(400);
  });

  it('400 - rejects invalid gender value', async () => {
    const res = await request(app).post(`${BASE}/register`).send({ ...validUser, email: 'u@t.com', gender: 'robot' });
    expect(res.status).toBe(400);
  });

  it('400 - rejects bio over 500 characters', async () => {
    const res = await request(app).post(`${BASE}/register`).send({ ...validUser, email: 'u@t.com', bio: 'B'.repeat(501) });
    expect(res.status).toBe(400);
  });

  it('400 - rejects more than 10 tags', async () => {
    const res = await request(app).post(`${BASE}/register`).send({ ...validUser, email: 'u@t.com', tags: Array(11).fill('tag') });
    expect(res.status).toBe(400);
  });
});

// ── LOGIN ──────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app).post(`${BASE}/register`).send(validUser);
  });

  it('200 - logs in with valid credentials', async () => {
    const res = await request(app).post(`${BASE}/login`).send({
      email: validUser.email,
      password: validUser.password,
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.message).toBe('Login successful');
  });

  it('200 - does NOT return password in response', async () => {
    const res = await request(app).post(`${BASE}/login`).send({
      email: validUser.email,
      password: validUser.password,
    });
    expect(res.body.user.password).toBeUndefined();
  });

  it('400 - rejects missing email', async () => {
    const res = await request(app).post(`${BASE}/login`).send({ password: validUser.password });
    expect(res.status).toBe(400);
  });

  it('400 - rejects invalid email format', async () => {
    const res = await request(app).post(`${BASE}/login`).send({ email: 'not-email', password: validUser.password });
    expect(res.status).toBe(400);
  });

  it('400 - rejects missing password', async () => {
    const res = await request(app).post(`${BASE}/login`).send({ email: validUser.email });
    expect(res.status).toBe(400);
  });

  it('401 - rejects wrong password', async () => {
    const res = await request(app).post(`${BASE}/login`).send({ email: validUser.email, password: 'WrongPass1' });
    expect(res.status).toBe(401);
  });

  it('401 - rejects nonexistent user', async () => {
    const res = await request(app).post(`${BASE}/login`).send({ email: 'nobody@test.com', password: 'Password1' });
    expect(res.status).toBe(401);
  });
});

// ── LOGOUT ─────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  let token;

  beforeEach(async () => {
    await request(app).post(`${BASE}/register`).send(validUser);
    const res = await request(app).post(`${BASE}/login`).send({
      email: validUser.email,
      password: validUser.password,
    });
    token = res.body.token;
  });

  it('200 - logs out with valid token', async () => {
    const res = await request(app).post(`${BASE}/logout`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Logged out successfully');
  });

  it('400 - rejects logout with no token', async () => {
    const res = await request(app).post(`${BASE}/logout`);
    expect(res.status).toBe(400);
  });

  it('401 - blacklisted token is rejected on protected routes', async () => {
    await request(app).post(`${BASE}/logout`).set('Authorization', `Bearer ${token}`);
    const res = await request(app).get('/api/profiles/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});

// ── REFRESH ────────────────────────────────────────────────────

describe('POST /api/auth/refresh', () => {
  let token;

  beforeEach(async () => {
    await request(app).post(`${BASE}/register`).send(validUser);
    const res = await request(app).post(`${BASE}/login`).send({
      email: validUser.email,
      password: validUser.password,
    });
    token = res.body.token;
  });

  it('200 - refreshes a valid token', async () => {
    const res = await request(app).post(`${BASE}/refresh`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('400 - rejects with no token', async () => {
    const res = await request(app).post(`${BASE}/refresh`);
    expect(res.status).toBe(400);
  });

  it('401 - rejects invalid token', async () => {
    const res = await request(app).post(`${BASE}/refresh`).set('Authorization', 'Bearer faketoken');
    expect(res.status).toBe(401);
  });
});


================================================================
FILE: tests/profiles.test.js
================================================================

jest.mock('../config/database');
jest.mock('../config/redis');

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const { connect, disconnect, clearCollections } = require('./helpers/dbSetup');
const { __resetStore } = require('../config/redis');

const AUTH = '/api/auth';
const PROFILES = '/api/profiles';

const makeUser = (email = 'alice@test.com') => ({
  email,
  password: 'Password1',
  name: 'Alice',
  age: 25,
  location: 'New York',
});

async function register(email) {
  const res = await request(app).post(`${AUTH}/register`).send(makeUser(email));
  return { token: res.body.token, userId: res.body.user._id };
}

beforeAll(() => connect());
afterAll(() => disconnect());
afterEach(async () => {
  await clearCollections();
  __resetStore();
});

// ── GET /me ────────────────────────────────────────────────────

describe('GET /api/profiles/me', () => {
  it('401 - no token', async () => {
    const res = await request(app).get(`${PROFILES}/me`);
    expect(res.status).toBe(401);
  });

  it('401 - invalid token', async () => {
    const res = await request(app).get(`${PROFILES}/me`).set('Authorization', 'Bearer badtoken');
    expect(res.status).toBe(401);
  });

  it('200 - returns own profile', async () => {
    const { token } = await register('alice@test.com');
    const res = await request(app).get(`${PROFILES}/me`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.profile).toBeDefined();
    expect(res.body.profile.name).toBe('Alice');
  });
});

// ── PUT /me ────────────────────────────────────────────────────

describe('PUT /api/profiles/me', () => {
  let token;

  beforeEach(async () => {
    ({ token } = await register('alice@test.com'));
  });

  it('401 - no token', async () => {
    const res = await request(app).put(`${PROFILES}/me`).send({ name: 'Bob' });
    expect(res.status).toBe(401);
  });

  it('200 - updates profile successfully', async () => {
    const res = await request(app)
      .put(`${PROFILES}/me`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Alice', bio: 'New bio' });
    expect(res.status).toBe(200);
    expect(res.body.profile.name).toBe('Updated Alice');
  });

  it('400 - rejects name under 2 characters', async () => {
    const res = await request(app).put(`${PROFILES}/me`).set('Authorization', `Bearer ${token}`).send({ name: 'A' });
    expect(res.status).toBe(400);
  });

  it('400 - rejects name over 50 characters', async () => {
    const res = await request(app).put(`${PROFILES}/me`).set('Authorization', `Bearer ${token}`).send({ name: 'A'.repeat(51) });
    expect(res.status).toBe(400);
  });

  it('400 - rejects age under 18', async () => {
    const res = await request(app).put(`${PROFILES}/me`).set('Authorization', `Bearer ${token}`).send({ age: 17 });
    expect(res.status).toBe(400);
  });

  it('400 - rejects age over 100', async () => {
    const res = await request(app).put(`${PROFILES}/me`).set('Authorization', `Bearer ${token}`).send({ age: 101 });
    expect(res.status).toBe(400);
  });

  it('400 - rejects bio over 500 characters', async () => {
    const res = await request(app).put(`${PROFILES}/me`).set('Authorization', `Bearer ${token}`).send({ bio: 'B'.repeat(501) });
    expect(res.status).toBe(400);
  });

  it('400 - rejects job over 100 characters', async () => {
    const res = await request(app).put(`${PROFILES}/me`).set('Authorization', `Bearer ${token}`).send({ job: 'J'.repeat(101) });
    expect(res.status).toBe(400);
  });
});

// ── GET /potential ─────────────────────────────────────────────

describe('GET /api/profiles/potential', () => {
  let token;

  beforeEach(async () => {
    ({ token } = await register('alice@test.com'));
  });

  it('401 - no token', async () => {
    const res = await request(app).get(`${PROFILES}/potential`);
    expect(res.status).toBe(401);
  });

  it('200 - returns profiles array', async () => {
    const res = await request(app).get(`${PROFILES}/potential`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.profiles)).toBe(true);
  });

  it('400 - rejects limit=0', async () => {
    const res = await request(app).get(`${PROFILES}/potential?limit=0`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('400 - rejects limit over 50', async () => {
    const res = await request(app).get(`${PROFILES}/potential?limit=51`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('400 - rejects negative offset', async () => {
    const res = await request(app).get(`${PROFILES}/potential?offset=-1`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

// ── GET /:userId ───────────────────────────────────────────────

describe('GET /api/profiles/:userId', () => {
  let token, userId, otherUserId;

  beforeEach(async () => {
    ({ token, userId } = await register('alice@test.com'));
    ({ userId: otherUserId } = await register('bob@test.com'));
  });

  it('401 - no token', async () => {
    const res = await request(app).get(`${PROFILES}/${otherUserId}`);
    expect(res.status).toBe(401);
  });

  it('400 - rejects own userId', async () => {
    const res = await request(app).get(`${PROFILES}/${userId}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('200 - returns another user profile', async () => {
    const res = await request(app).get(`${PROFILES}/${otherUserId}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.profile).toBeDefined();
  });

  it('404 - nonexistent userId', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app).get(`${PROFILES}/${fakeId}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

// ── GET /me/liked ──────────────────────────────────────────────

describe('GET /api/profiles/me/liked', () => {
  let token;

  beforeEach(async () => {
    ({ token } = await register('alice@test.com'));
  });

  it('401 - no token', async () => {
    const res = await request(app).get(`${PROFILES}/me/liked`);
    expect(res.status).toBe(401);
  });

  it('200 - returns empty liked profiles initially', async () => {
    const res = await request(app).get(`${PROFILES}/me/liked`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.profiles).toHaveLength(0);
  });
});

// ── PUT /me/preferences ────────────────────────────────────────

describe('PUT /api/profiles/me/preferences', () => {
  let token;

  beforeEach(async () => {
    ({ token } = await register('alice@test.com'));
  });

  it('401 - no token', async () => {
    const res = await request(app).put(`${PROFILES}/me/preferences`).send({ maxDistance: 100 });
    expect(res.status).toBe(401);
  });

  it('200 - updates maxDistance', async () => {
    const res = await request(app)
      .put(`${PROFILES}/me/preferences`)
      .set('Authorization', `Bearer ${token}`)
      .send({ maxDistance: 100 });
    expect(res.status).toBe(200);
    expect(res.body.preferences.maxDistance).toBe(100);
  });

  it('400 - rejects maxDistance over 500', async () => {
    const res = await request(app)
      .put(`${PROFILES}/me/preferences`)
      .set('Authorization', `Bearer ${token}`)
      .send({ maxDistance: 501 });
    expect(res.status).toBe(400);
  });

  it('400 - rejects ageRange.min under 18', async () => {
    const res = await request(app)
      .put(`${PROFILES}/me/preferences`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ageRange: { min: 16, max: 30 } });
    expect(res.status).toBe(400);
  });
});


================================================================
FILE: tests/likes.test.js
================================================================

jest.mock('../config/database');
jest.mock('../config/redis');

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const { connect, disconnect, clearCollections } = require('./helpers/dbSetup');
const { __resetStore } = require('../config/redis');

const AUTH = '/api/auth';
const LIKES = '/api/likes';

const makeUser = (email) => ({ email, password: 'Password1', name: 'User', age: 25, location: 'NYC' });

async function register(email) {
  const res = await request(app).post(`${AUTH}/register`).send(makeUser(email));
  return { token: res.body.token, userId: res.body.user._id };
}

beforeAll(() => connect());
afterAll(() => disconnect());
afterEach(async () => {
  await clearCollections();
  __resetStore();
});

// ── POST / ─────────────────────────────────────────────────────

describe('POST /api/likes', () => {
  let tokenA, userBId;

  beforeEach(async () => {
    ({ token: tokenA } = await register('a@test.com'));
    ({ userId: userBId } = await register('b@test.com'));
  });

  it('401 - no token', async () => {
    const res = await request(app).post(LIKES).send({ profileId: userBId });
    expect(res.status).toBe(401);
  });

  it('400 - missing profileId', async () => {
    const res = await request(app).post(LIKES).set('Authorization', `Bearer ${tokenA}`).send({});
    expect(res.status).toBe(400);
  });

  it('400 - invalid profileId format', async () => {
    const res = await request(app).post(LIKES).set('Authorization', `Bearer ${tokenA}`).send({ profileId: 'not-an-id' });
    expect(res.status).toBe(400);
  });

  it('400 - nonexistent profileId', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app).post(LIKES).set('Authorization', `Bearer ${tokenA}`).send({ profileId: fakeId });
    expect(res.status).toBe(400);
  });

  it('200 - likes a valid profile', async () => {
    const res = await request(app).post(LIKES).set('Authorization', `Bearer ${tokenA}`).send({ profileId: userBId });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('409 - cannot like the same profile twice', async () => {
    await request(app).post(LIKES).set('Authorization', `Bearer ${tokenA}`).send({ profileId: userBId });
    const res = await request(app).post(LIKES).set('Authorization', `Bearer ${tokenA}`).send({ profileId: userBId });
    expect(res.status).toBe(409);
  });
});

// ── GET /check/:profileId ──────────────────────────────────────

describe('GET /api/likes/check/:profileId', () => {
  let tokenA, userBId;

  beforeEach(async () => {
    ({ token: tokenA } = await register('a@test.com'));
    ({ userId: userBId } = await register('b@test.com'));
  });

  it('401 - no token', async () => {
    const res = await request(app).get(`${LIKES}/check/${userBId}`);
    expect(res.status).toBe(401);
  });

  it('200 - returns hasLiked: false for unliked profile', async () => {
    const res = await request(app).get(`${LIKES}/check/${userBId}`).set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.hasLiked).toBe(false);
  });

  it('200 - returns hasLiked: true after liking', async () => {
    await request(app).post(LIKES).set('Authorization', `Bearer ${tokenA}`).send({ profileId: userBId });
    __resetStore(); // clear redis cache so DB is checked
    const res = await request(app).get(`${LIKES}/check/${userBId}`).set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.hasLiked).toBe(true);
  });
});

// ── GET /my-likes ──────────────────────────────────────────────

describe('GET /api/likes/my-likes', () => {
  let token;

  beforeEach(async () => {
    ({ token } = await register('a@test.com'));
  });

  it('401 - no token', async () => {
    const res = await request(app).get(`${LIKES}/my-likes`);
    expect(res.status).toBe(401);
  });

  it('200 - returns empty list initially', async () => {
    const res = await request(app).get(`${LIKES}/my-likes`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.profiles).toHaveLength(0);
  });
});

// ── GET /received ──────────────────────────────────────────────
// NOTE: This route has a bug — it does `const { Like } = require('../models/Like')`
// but models/Like.js exports the model directly (not { Like }), so Like is undefined
// causing a 500. Tracked as bug.

describe('GET /api/likes/received', () => {
  let token;

  beforeEach(async () => {
    ({ token } = await register('a@test.com'));
  });

  it('401 - no token', async () => {
    const res = await request(app).get(`${LIKES}/received`);
    expect(res.status).toBe(401);
  });
});

// ── GET /matches ───────────────────────────────────────────────
// NOTE: Same destructuring bug as /received — Match will be undefined → 500.

describe('GET /api/likes/matches', () => {
  let token;

  beforeEach(async () => {
    ({ token } = await register('a@test.com'));
  });

  it('401 - no token', async () => {
    const res = await request(app).get(`${LIKES}/matches`);
    expect(res.status).toBe(401);
  });
});

// ── POST /validate ─────────────────────────────────────────────

describe('POST /api/likes/validate', () => {
  let tokenA, userBId;

  beforeEach(async () => {
    ({ token: tokenA } = await register('a@test.com'));
    ({ userId: userBId } = await register('b@test.com'));
  });

  it('401 - no token', async () => {
    const res = await request(app).post(`${LIKES}/validate`).send({ profileId: userBId });
    expect(res.status).toBe(401);
  });

  it('400 - invalid profileId format', async () => {
    const res = await request(app).post(`${LIKES}/validate`).set('Authorization', `Bearer ${tokenA}`).send({ profileId: 'bad' });
    expect(res.status).toBe(400);
  });

  it('200 - returns valid: true for a valid unliked profile', async () => {
    const res = await request(app).post(`${LIKES}/validate`).set('Authorization', `Bearer ${tokenA}`).send({ profileId: userBId });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });
});


================================================================
FILE: tests/rejects.test.js
================================================================

jest.mock('../config/database');
jest.mock('../config/redis');

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const { connect, disconnect, clearCollections } = require('./helpers/dbSetup');
const { __resetStore } = require('../config/redis');

const AUTH = '/api/auth';
const REJECTS = '/api/rejects';

const makeUser = (email) => ({ email, password: 'Password1', name: 'User', age: 25, location: 'NYC' });

async function register(email) {
  const res = await request(app).post(`${AUTH}/register`).send(makeUser(email));
  return { token: res.body.token, userId: res.body.user._id };
}

beforeAll(() => connect());
afterAll(() => disconnect());
afterEach(async () => {
  await clearCollections();
  __resetStore();
});

// ── POST / ─────────────────────────────────────────────────────

describe('POST /api/rejects', () => {
  let tokenA, userBId;

  beforeEach(async () => {
    ({ token: tokenA } = await register('a@test.com'));
    ({ userId: userBId } = await register('b@test.com'));
  });

  it('401 - no token', async () => {
    const res = await request(app).post(REJECTS).send({ profileId: userBId });
    expect(res.status).toBe(401);
  });

  it('400 - missing profileId', async () => {
    const res = await request(app).post(REJECTS).set('Authorization', `Bearer ${tokenA}`).send({});
    expect(res.status).toBe(400);
  });

  it('400 - invalid profileId format', async () => {
    const res = await request(app).post(REJECTS).set('Authorization', `Bearer ${tokenA}`).send({ profileId: 'not-an-id' });
    expect(res.status).toBe(400);
  });

  it('400 - nonexistent profileId', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app).post(REJECTS).set('Authorization', `Bearer ${tokenA}`).send({ profileId: fakeId });
    expect(res.status).toBe(400);
  });

  it('200 - rejects a valid profile', async () => {
    const res = await request(app).post(REJECTS).set('Authorization', `Bearer ${tokenA}`).send({ profileId: userBId });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('409 - cannot reject the same profile twice', async () => {
    await request(app).post(REJECTS).set('Authorization', `Bearer ${tokenA}`).send({ profileId: userBId });
    const res = await request(app).post(REJECTS).set('Authorization', `Bearer ${tokenA}`).send({ profileId: userBId });
    expect(res.status).toBe(409);
  });
});

// ── GET /check/:profileId ──────────────────────────────────────

describe('GET /api/rejects/check/:profileId', () => {
  let tokenA, userBId;

  beforeEach(async () => {
    ({ token: tokenA } = await register('a@test.com'));
    ({ userId: userBId } = await register('b@test.com'));
  });

  it('401 - no token', async () => {
    const res = await request(app).get(`${REJECTS}/check/${userBId}`);
    expect(res.status).toBe(401);
  });

  it('200 - returns hasRejected: false initially', async () => {
    const res = await request(app).get(`${REJECTS}/check/${userBId}`).set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.hasRejected).toBe(false);
  });

  it('200 - returns hasRejected: true after rejecting', async () => {
    await request(app).post(REJECTS).set('Authorization', `Bearer ${tokenA}`).send({ profileId: userBId });
    __resetStore();
    const res = await request(app).get(`${REJECTS}/check/${userBId}`).set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.hasRejected).toBe(true);
  });
});

// ── GET /my-rejects ────────────────────────────────────────────

describe('GET /api/rejects/my-rejects', () => {
  let token;

  beforeEach(async () => {
    ({ token } = await register('a@test.com'));
  });

  it('401 - no token', async () => {
    const res = await request(app).get(`${REJECTS}/my-rejects`);
    expect(res.status).toBe(401);
  });

  it('200 - returns empty list initially', async () => {
    const res = await request(app).get(`${REJECTS}/my-rejects`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.profiles).toHaveLength(0);
  });
});

// ── GET /analytics ─────────────────────────────────────────────

describe('GET /api/rejects/analytics', () => {
  let token;

  beforeEach(async () => {
    ({ token } = await register('a@test.com'));
  });

  it('401 - no token', async () => {
    const res = await request(app).get(`${REJECTS}/analytics`);
    expect(res.status).toBe(401);
  });

  it('200 - returns analytics object', async () => {
    const res = await request(app).get(`${REJECTS}/analytics`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.totalRejects).toBeDefined();
    expect(res.body.recentRejects).toBeDefined();
    expect(res.body.averagePerDay).toBeDefined();
  });
});


================================================================
FILE: tests/superLikes.test.js
================================================================

jest.mock('../config/database');
jest.mock('../config/redis');

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const { connect, disconnect, clearCollections } = require('./helpers/dbSetup');
const { __resetStore } = require('../config/redis');

const AUTH = '/api/auth';
const SUPER_LIKES = '/api/super-likes';

const makeUser = (email) => ({ email, password: 'Password1', name: 'User', age: 25, location: 'NYC' });

async function register(email) {
  const res = await request(app).post(`${AUTH}/register`).send(makeUser(email));
  return { token: res.body.token, userId: res.body.user._id };
}

beforeAll(() => connect());
afterAll(() => disconnect());
afterEach(async () => {
  await clearCollections();
  __resetStore();
});

// ── POST / ─────────────────────────────────────────────────────

describe('POST /api/super-likes', () => {
  let tokenA, userBId;

  beforeEach(async () => {
    ({ token: tokenA } = await register('a@test.com'));
    ({ userId: userBId } = await register('b@test.com'));
  });

  it('401 - no token', async () => {
    const res = await request(app).post(SUPER_LIKES).send({ profileId: userBId });
    expect(res.status).toBe(401);
  });

  it('400 - missing profileId', async () => {
    const res = await request(app).post(SUPER_LIKES).set('Authorization', `Bearer ${tokenA}`).send({});
    expect(res.status).toBe(400);
  });

  it('400 - invalid profileId format', async () => {
    const res = await request(app).post(SUPER_LIKES).set('Authorization', `Bearer ${tokenA}`).send({ profileId: 'bad-id' });
    expect(res.status).toBe(400);
  });

  it('200 - super likes a valid profile', async () => {
    const res = await request(app).post(SUPER_LIKES).set('Authorization', `Bearer ${tokenA}`).send({ profileId: userBId });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('429 - second super like exceeds daily quota (limit=1)', async () => {
    const { userId: userCId } = await register('c@test.com');
    await request(app).post(SUPER_LIKES).set('Authorization', `Bearer ${tokenA}`).send({ profileId: userBId });
    const res = await request(app).post(SUPER_LIKES).set('Authorization', `Bearer ${tokenA}`).send({ profileId: userCId });
    expect(res.status).toBe(429);
  });

  it('409 - cannot super-like the same profile twice', async () => {
    await request(app).post(SUPER_LIKES).set('Authorization', `Bearer ${tokenA}`).send({ profileId: userBId });
    // reset quota so we hit the duplicate check, not the quota check
    await request(app).post(`${SUPER_LIKES}/quota/reset`).set('Authorization', `Bearer ${tokenA}`);
    const res = await request(app).post(SUPER_LIKES).set('Authorization', `Bearer ${tokenA}`).send({ profileId: userBId });
    expect(res.status).toBe(409);
  });
});

// ── GET /quota ─────────────────────────────────────────────────

describe('GET /api/super-likes/quota', () => {
  let token;

  beforeEach(async () => {
    ({ token } = await register('a@test.com'));
  });

  it('401 - no token', async () => {
    const res = await request(app).get(`${SUPER_LIKES}/quota`);
    expect(res.status).toBe(401);
  });

  it('200 - returns quota info', async () => {
    const res = await request(app).get(`${SUPER_LIKES}/quota`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.dailyLimit).toBeDefined();
    expect(res.body.remaining).toBeDefined();
    expect(res.body.isAvailable).toBe(true);
  });
});

// ── GET /quota/available ───────────────────────────────────────

describe('GET /api/super-likes/quota/available', () => {
  let token;

  beforeEach(async () => {
    ({ token } = await register('a@test.com'));
  });

  it('401 - no token', async () => {
    const res = await request(app).get(`${SUPER_LIKES}/quota/available`);
    expect(res.status).toBe(401);
  });

  it('200 - returns isAvailable: true initially', async () => {
    const res = await request(app).get(`${SUPER_LIKES}/quota/available`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.isAvailable).toBe(true);
  });
});

// ── GET /my-super-likes ────────────────────────────────────────

describe('GET /api/super-likes/my-super-likes', () => {
  let token;

  beforeEach(async () => {
    ({ token } = await register('a@test.com'));
  });

  it('401 - no token', async () => {
    const res = await request(app).get(`${SUPER_LIKES}/my-super-likes`);
    expect(res.status).toBe(401);
  });

  it('200 - returns empty list initially', async () => {
    const res = await request(app).get(`${SUPER_LIKES}/my-super-likes`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.profiles).toHaveLength(0);
  });
});

// ── GET /received ──────────────────────────────────────────────
// NOTE: Same destructuring bug as likes/received — { Like } from Like model
// export will be undefined → 500 for authenticated requests.

describe('GET /api/super-likes/received', () => {
  let token;

  beforeEach(async () => {
    ({ token } = await register('a@test.com'));
  });

  it('401 - no token', async () => {
    const res = await request(app).get(`${SUPER_LIKES}/received`);
    expect(res.status).toBe(401);
  });
});


================================================================
KNOWN BUGS FOUND DURING TEST WRITING
================================================================

1. routes/likes.js GET /received (line ~90):
   const { Like } = require('../models/Like')
   → models/Like.js exports the model directly, not { Like }
   → Like is undefined → TypeError → 500

2. routes/likes.js GET /matches (line ~126):
   const { Match } = require('../models/Match')
   → Same issue → Match is undefined → 500

3. routes/superLikes.js GET /received (line ~93):
   const { Like } = require('../models/Like')
   → Same issue → 500

FIX for all three: change to:
   const Like = require('../models/Like')
   const Match = require('../models/Match')

================================================================

