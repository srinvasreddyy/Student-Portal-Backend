const express = require('express');
const asyncWrapper = require('../middleware/asyncWrapper');

const router = express.Router();

router.get(
    '/healthz',
    asyncWrapper(async (req, res) => {
        res.status(200).json({
            status: 'ok',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
        });
    })
);

module.exports = router;
