const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const University = require('../src/models/University');
const config = require('../src/config');
const axios = require('axios');

jest.mock('axios');

describe('University Search Endpoint', () => {
    beforeAll(async () => {
        if (mongoose.connection.readyState === 0) {
            await mongoose.connect(config.db.uri || 'mongodb://localhost:27017/mern_db_test');
        }
    });

    afterAll(async () => {
        await mongoose.connection.close();
    });

    it('1. Search returns domains from upstream API (mocked)', async () => {
        const mockResponse = {
            data: [
                {
                    name: 'University of Example',
                    country: 'United Kingdom',
                    domains: ['example.ac.uk'],
                    web_pages: ['https://www.example.ac.uk']
                }
            ]
        };
        axios.get.mockResolvedValueOnce(mockResponse);

        const res = await request(app).get('/universities/search?q=Example&country=United%20Kingdom');

        expect(res.status).toBe(200);
        expect(res.body.length).toBe(1);
        expect(res.body[0].name).toBe('University of Example');
        expect(res.body[0].domains).toContain('example.ac.uk');

        // Assert upstream was called with expected URL params
        expect(axios.get).toHaveBeenCalledWith(
            expect.stringContaining('name=Example&country=United+Kingdom'),
            expect.any(Object)
        );
    });

    it('2. Caching reduces repeated external calls', async () => {
        const mockResponse = {
            data: [{ name: 'Cached University', country: 'US', domains: ['cache.edu'], web_pages: [] }]
        };
        // Reset call count
        axios.get.mockClear();
        axios.get.mockResolvedValueOnce(mockResponse);

        // First call
        await request(app).get('/universities/search?q=CacheMe');
        expect(axios.get).toHaveBeenCalledTimes(1);

        // Second call (should hit cache)
        const res2 = await request(app).get('/universities/search?q=CacheMe');
        expect(axios.get).toHaveBeenCalledTimes(1); // Still 1
        expect(res2.body[0].name).toBe('Cached University');
    });

    it('3. Upstream timeout error handling', async () => {
        // Reset cache/axio by using a unique query
        axios.get.mockClear();
        const timeoutError = new Error('timeout');
        timeoutError.code = 'ECONNABORTED';
        axios.get.mockRejectedValueOnce(timeoutError);

        const res = await request(app).get('/universities/search?q=TimeoutTest');

        expect(res.status).toBe(500);
        expect(res.body.message).toMatch(/upstream_timeout/i);
    });
});
