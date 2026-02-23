require('dotenv').config();

const requiredEnvVars = [
    'MONGO_URI',
    'PORT',
    'JWT_SECRET',
    'JWT_EXPIRES_IN',
    'REFRESH_TOKEN_SECRET',
];

requiredEnvVars.forEach((envVar) => {
    if (!process.env[envVar] && process.env.NODE_ENV !== 'test') {
        throw new Error(`Environment variable ${envVar} is missing.`);
    }
});

// Helper to parse ALLOWED_ORIGINS safely
const parseAllowedOrigins = () => {
    const origins = process.env.ALLOWED_ORIGINS || 'http://localhost:3000';
    return origins.split(',').map((origin) => origin.trim());
};

module.exports = {
    app: {
        port: parseInt(process.env.PORT, 10) || 3000,
        env: process.env.NODE_ENV || 'development',
    },
    db: {
        uri: process.env.MONGO_URI,
    },
    jwt: {
        secret: process.env.JWT_SECRET,
        expiresIn: process.env.JWT_EXPIRES_IN,
        refreshSecret: process.env.REFRESH_TOKEN_SECRET,
    },
    email: {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT, 10) || 587,
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
    vendors: {
        companiesHouseKey: process.env.COMPANIES_HOUSE_API_KEY,
        openCorporatesToken: process.env.OPENCORPORATES_TOKEN,
    },
    cors: {
        allowedOrigins: parseAllowedOrigins(),
    },
};
