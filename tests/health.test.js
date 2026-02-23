const request = require('supertest');
const app = require('../src/app');

describe('Health Check API', () => {
    it('GET /healthz returns 200 and JSON { status: "ok" }', async () => {
        const response = await request(app).get('/healthz');

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('status', 'ok');
        expect(response.body).toHaveProperty('uptime');
        expect(response.body).toHaveProperty('timestamp');
    });
});
