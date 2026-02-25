const EmailSendAttempt = require('../models/EmailSendAttempt');
const mailerService = require('../services/mailer');
const mongoose = require('mongoose');

/**
 * IN-PROCESS DURABLE QUEUE WORKER
 * 
 * SCALING TRADEOFFS & MIGRATION:
 * This runs inside the main Node.js event loop using `setInterval`.
 * 
 * Tradeoffs:
 * - Simple: No extra infra (Redis/RabbitMQ) needed. Good for MVPs.
 * - Concurrency risks: If you run multiple Node instances (cluster/pm2), they will race condition 
 *   to fetch the same 'queued' database rows.
 * - Heavy: Polling MongoDB isn't perfect for scale.
 * 
 * Migration to BullMQ + Redis:
 * If migrating, do NOT poll DB. Instead, `mailerService.enqueueMail()` should directly do:
 * `await emailQueue.add('sendEmail', { attemptId })` where emailQueue is a BullMQ instance.
 * Then this file becomes a native BullMQ Worker: 
 * `new Worker('sendEmail', async job => { ... }, { connection: redisClient })`.
 * Read docs: https://docs.bullmq.io/guide/workers
 */

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 2000; // Base delay for exponential backoff

class EmailJobProcessor {
    constructor() {
        this.isRunning = false;
        this.pollInterval = null;
    }

    start(intervalMs = 5000) {
        if (this.isRunning) return;
        this.isRunning = true;

        console.log(`Starting in-process email worker (polling every ${intervalMs}ms)`);

        this.pollInterval = setInterval(() => {
            this.processQueue().catch(err => console.error('Queue processing error:', err));
        }, intervalMs);
    }

    stop() {
        if (this.pollInterval) clearInterval(this.pollInterval);
        this.isRunning = false;
    }

    async processQueue() {
        // Find jobs that are queued, order by oldest first
        // In a real multi-node app without Redis, you MUST use findOneAndUpdate with sorting and state locking
        const jobs = await EmailSendAttempt.find({ status: 'queued' })
            .sort({ createdAt: 1 })
            .limit(10); // Batch size

        if (!jobs || jobs.length === 0) return;

        for (const job of jobs) {
            // Check retry backoff limit
            if (job.attempts > 0) {
                const backoffTime = BACKOFF_BASE_MS * Math.pow(2, job.attempts - 1); // Exponential + Jitter
                const jitter = Math.floor(Math.random() * 500);
                const readyTime = new Date(job.updatedAt.getTime() + backoffTime + jitter);

                // Skip if not ready for retry yet
                if (new Date() < readyTime) {
                    continue;
                }
            }

            try {
                // Attempt send (mailer updates doc internally on success)
                await mailerService._processSendAttempt(job);
            } catch (err) {
                // Reload: _processSendAttempt already incremented + saved the attempt count
                const updatedJob = await EmailSendAttempt.findById(job._id);
                // The mailer tracked the attempt. If we hit the max, mark it completely failed.
                if (updatedJob.attempts >= MAX_RETRIES) {
                    updatedJob.status = 'failed';
                    await updatedJob.save();
                    console.error(`Job ${job._id} marked as definitively failed after ${MAX_RETRIES} attempts.`);
                } else {
                    // Remains 'queued', will be picked up next poll if backoff expires
                    console.warn(`Job ${updatedJob._id} failed temp. Retries: ${updatedJob.attempts}/${MAX_RETRIES}`);
                }
            }
        }
    }
}

module.exports = new EmailJobProcessor();
