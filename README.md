# Backend Scaffold

Production-ready Express + MongoDB backend (strictly JavaScript) for the MERN product.

## Prerequisites
- Node.js (>= 18)
- MongoDB running locally or a valid connection URI

## Environment Variables
Copy `.env.example` to `.env` and fill in the blanks:

- `MONGO_URI`: The MongoDB connection string
- `PORT`: Port on which the API will run (default 3000)
- `NODE_ENV`: 'development' or 'production'
- `JWT_SECRET`: Secret key for signing JSON Web Tokens
- `JWT_EXPIRES_IN`: Expiration time for access tokens (e.g., 15m)
- `REFRESH_TOKEN_SECRET`: Secret key for refresh tokens
- `SMTP_HOST`: Mail server domain (e.g. smtp.ethereal.email)
- `SMTP_PORT`: Mail server port
- `SMTP_USER` & `SMTP_PASS`: Mail server credentials
- `COMPANIES_HOUSE_API_KEY`: Key for checking UK company registries
- `OPENCORPORATES_TOKEN`: Token for global company registries
- `ALLOWED_ORIGINS`: Comma-separated list of allowed CORS origins (e.g., http://localhost:3000)

## Commands

### Install dependencies
\`\`\`bash
npm install
\`\`\`

### Start server for development
\`\`\`bash
npm run dev
\`\`\`

### Run Tests
\`\`\`bash
npm test
\`\`\`
