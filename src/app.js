const express = require('express');
const cors = require('cors');
const securityHeaders = require('./middleware/securityHeaders');


const config = require('./config');
const errorHandler = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const companiesRoutes = require('./routes/companies');
const universitiesRoutes = require('./routes/universities');
const adminRoutes = require('./routes/admin');
const projectsRoutes = require('./routes/projects');
const studentsRoutes = require('./routes/students');

const app = express();

// CORS MUST be registered before any middleware that may short-circuit (rate limiter, etc.)
// so that error responses (429, 403, etc.) still carry the proper CORS headers.
app.use(
    cors({
        origin: function (origin, callback) {
            if (!origin || config.cors.allowedOrigins.includes(origin) || config.cors.allowedOrigins.includes('*')) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        },
        credentials: true,
    })
);

// Security middleware (after CORS)
app.use(securityHeaders());
app.use(require('./middleware/mongoSanitizer')()); // NoSQL Injection 


// Body parsers
app.use(express.json({ limit: '100kb' }));

// URL encoded body parser
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Health and Readiness
app.get('/healthz', (req, res) => {
    res.status(200).json({ status: 'OK', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.get('/ready', (req, res) => {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
        res.status(200).json({ status: 'Ready', db: 'Connected' });
    } else {
        res.status(503).json({ status: 'Not Ready', db: 'Disconnected' });
    }
});

// Router mount
app.use('/auth', authRoutes);
app.use('/companies', companiesRoutes);
app.use('/universities', universitiesRoutes);
app.use('/admin', adminRoutes);
app.use('/projects', projectsRoutes);
app.use('/students', studentsRoutes);
const notificationRoutes = require('./routes/notifications');
const registrationRoutes = require('./routes/registration');
app.use('/api', notificationRoutes); // Has /notifications and /admin/email-sends
app.use('/api', registrationRoutes);

// JSON error parsing and centralized error handler
app.use(errorHandler);

module.exports = app;
