/**
 * Docs read & endpoints cited:
 * - Mongoose Transactions: https://mongoosejs.com/docs/transactions.html
 * - MongoDB Transactions: https://www.mongodb.com/docs/manual/core/transactions/
 * - MongoDB Core API (Session): https://www.mongodb.com/docs/manual/reference/method/Session.startTransaction/
 */

const mongoose = require('mongoose');
const logger = require('./logger');

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isTransientError(error) {
    return error.hasErrorLabel && error.hasErrorLabel('TransientTransactionError');
}

/**
 * Execute a function within a Mongoose transaction, with exponential backoff 
 * retries for transient transaction errors (like write conflicts).
 * 
 * @param {mongoose.Connection} conn The mongoose connection
 * @param {Function} work Function to execute inside transaction, receives session
 * @param {Number} maxRetries Max attempts
 * @returns {any} Result of the work function
 */
async function withTransaction(conn, work, maxRetries = 3) {
    let attempt = 0;
    while (attempt < maxRetries) {
        const session = await conn.startSession();
        try {
            session.startTransaction();

            // Execute the provided function passing the session
            const result = await work(session);

            // Transaction MUST be explicitly committed
            await session.commitTransaction();
            return result;
        } catch (err) {
            // Abort on any error
            await session.abortTransaction();

            // If it's a Transient transaction error, retry with exponential backoff
            if (isTransientError(err) && attempt < maxRetries - 1) {
                attempt++;
                logger.warn(`TransientTransactionError caught. Retrying transaction (Attempt ${attempt}/${maxRetries - 1})...`);
                await sleep(100 * Math.pow(2, attempt));
                continue;
            }

            // Not a transient error, or out of retries
            throw err;
        } finally {
            // Always end session
            session.endSession();
        }
    }
}

module.exports = {
    withTransaction,
    sleep,
    isTransientError
};
