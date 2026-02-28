const { StreamChat } = require('stream-chat');
require('dotenv').config();

const apiKey = process.env.STREAM_API_KEY || 'your_stream_api_key_here';
const apiSecret = process.env.STREAM_API_SECRET || 'your_stream_api_secret_here';

if (!apiKey || !apiSecret) {
    console.warn("Stream API credentials are not set in the environment variables.");
}

const serverClient = StreamChat.getInstance(apiKey, apiSecret);

module.exports = serverClient;
