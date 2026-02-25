const express = require('express');
const cors = require('cors');
const securityHeaders = require('./middleware/securityHeaders');
const { globalRateLimiter } = require('./middleware/globalRateLimiter');

const config = require('./config');
const errorHandler = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const companiesRoutes = require('./routes/companies');
const universitiesRoutes = require('./routes/universities');
const adminRoutes = require('./routes/admin');
const projectsRoutes = require('./routes/projects');
const studentsRoutes = require('./routes/students');
const chatRoutes = require('./routes/chat');

const app = express();

// Security middleware
app.use(securityHeaders());
app.use(require('./middleware/mongoSanitizer')()); // NoSQL Injection 
app.use(globalRateLimiter);

// CORS configuration respects ALLOWED_ORIGINS (comma-separated string)
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

// CORS configuration respects ALLOWED_ORIGINS
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
app.use('/chat', chatRoutes); // Mounted chat routes
const notificationRoutes = require('./routes/notifications');
const registrationRoutes = require('./routes/registration');
app.use('/api', notificationRoutes); // Has /notifications and /admin/email-sends
app.use('/api', registrationRoutes);

// JSON error parsing and centralized error handler
app.use(errorHandler);

module.exports = app;
