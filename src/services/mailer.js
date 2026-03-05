const nodemailer = require('nodemailer');
const fs = require('fs/promises');
const path = require('path');
const EmailSendAttempt = require('../models/EmailSendAttempt');

/**
 * References:
 * Nodemailer Ethereal testing: https://nodemailer.com/about/#example
 * Nodemailer Error Handling: Transporter returns a Promise -> try/catch
 */

const templates = {
    approve: (url) => `<p>Your application is approved. Proceed to <a href="${url || '#'}">Onboarding</a>.</p>`,
    hold: (reason) => `<p>Your application is on hold. Reason: ${reason}</p>`,
    reject: (reason) => `<p>Your application was rejected. Reason: ${reason}</p>`
};

class MailerService {
    constructor() {
        this.transporter = null;
        this.isEthereal = false;
    }

    async init() {
        if (this.transporter) return;

        // If SMTP vars are present, use them
        if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.NODE_ENV === 'production') {
            this.transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: process.env.SMTP_PORT || 587,
                secure: process.env.SMTP_PORT == 465,
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS
                }
            });
            console.log('Mailer initialized with production SMTP credentials');
        } else {
            // Development fallback: auto-create Ethereal account
            console.log('No production SMTP configured. Generating Ethereal test account...');
            const testAccount = await nodemailer.createTestAccount();
            this.transporter = nodemailer.createTransport({
                host: 'smtp.ethereal.email',
                port: 587,
                secure: false, // true for 465, false for other ports
                auth: {
                    user: testAccount.user, // generated ethereal user
                    pass: testAccount.pass  // generated ethereal password
                }
            });
            this.isEthereal = true;
            console.log(`Ethereal auth created. User: ${testAccount.user}`);
        }
    }

    /**
     * Legacy generic sendEmail method
     */
    async sendEmail(to, subject, html) {
        await this.init();
        const mailOptions = {
            from: process.env.MAIL_FROM || '"Global Academy Platform" <no-reply@ethereal.email>',
            to,
            subject,
            html
        };
        const info = await this.transporter.sendMail(mailOptions);
        if (this.isEthereal && nodemailer.getTestMessageUrl) {
            console.log(`Preview URL: ${nodemailer.getTestMessageUrl(info)}`);
        }
        return info;
    }

    async sendVerificationEmail(to, code, applicationId) {
        return this.sendWithRetry({
            applicationId,
            to,
            subject: 'Verify Your Application',
            htmlContent: `<p>Your verification code is: <strong>${code}</strong></p><p>This code expires in 15 minutes.</p>`,
            force: true
        });
    }

    /**
     * Replaces simple {{key}} placeholders in HTML string with payload values
     * @param {string} html 
     * @param {object} payload 
     * @returns {string} parsed HTML
     */
    parseTemplate(html, payload = {}) {
        return html.replace(/\{\{(\w+)\}\}/g, (match, key) => {
            // Basic XSS safety or null substitution
            return payload[key] !== undefined ? payload[key] : '';
        });
    }

    /**
     * Enqueues an email process if requested, or sends it immediately.
     * Enqueueing is the preferred method for phase 8 (Durable outbox pattern)
     */
    async enqueueMail({ to, subject, templateName, payload, sendKey, userRef }) {
        // Create the EmailSendAttempt to track the outbound request locally
        const attempt = new EmailSendAttempt({
            to,
            subject,
            templateName,
            payload,
            sendKey,
            userRef,
            status: 'queued'
        });

        const saved = await attempt.save();

        // In a robust system, this triggers Bull/Redis or our in-process worker
        return { success: true, attemptId: saved._id };
    }

    async sendWithRetry({ applicationId, targetType, to, subject, templateName, htmlContent, sendKey, force }) {
        if (!force && sendKey) {
            const existing = await EmailSendAttempt.findOne({ sendKey });
            if (existing) return { success: true, messageId: existing.messageId };
        }

        const attempt = new EmailSendAttempt({
            applicationId,
            to,
            subject,
            templateName,
            sendKey,
            status: 'queued'
        });
        await attempt.save();

        try {
            await this.init();
            const mailOptions = {
                from: process.env.MAIL_FROM || '"Global Academy Platform" <no-reply@ethereal.email>',
                to,
                subject,
                html: htmlContent
            };
            const info = await this.transporter.sendMail(mailOptions);
            attempt.status = 'sent';
            attempt.messageId = info.messageId || 'm-id';
            attempt.attempts += 1;
            await attempt.save();
            return { success: true, messageId: attempt.messageId };
        } catch (error) {
            attempt.status = 'failed';
            attempt.lastError = error.message;
            attempt.attempts += 1;
            await attempt.save();
            throw error;
        }
    }

    /**
     * The actual underlying send command executed by the worker.
     * Takes an EmailSendAttempt document and interacts with Nodemailer.
     */
    async _processSendAttempt(attemptDoc) {
        await this.init(); // Ensure transporter is ready

        let html = '';
        if (attemptDoc.templateName) {
            try {
                const templatePath = path.join(__dirname, '..', 'templates', `${attemptDoc.templateName}.html`);
                const rawTemplate = await fs.readFile(templatePath, 'utf-8');
                html = this.parseTemplate(rawTemplate, attemptDoc.payload);
            } catch (err) {
                console.error(`Failed to load template ${attemptDoc.templateName}`, err);
                // Can fallback to a plain text if desired
                html = `<p>Error loading template.</p><pre>${JSON.stringify(attemptDoc.payload)}</pre>`;
            }
        }

        const mailOptions = {
            from: process.env.MAIL_FROM || '"Global Academy Platform" <no-reply@ethereal.email>',
            to: attemptDoc.to,
            subject: attemptDoc.subject,
            html: html,
            // Implementing RFC 8058 Best Practices for unsubscribes if this was marketing, 
            // but since it's transactional, we exclude them, or only add them if specified.
        };

        try {
            const info = await this.transporter.sendMail(mailOptions);

            if (this.isEthereal) {
                console.log(`Preview URL for email to ${attemptDoc.to}: ${nodemailer.getTestMessageUrl(info)}`);
            }

            // Update Doc
            attemptDoc.status = 'sent';
            attemptDoc.messageId = info.messageId;
            attemptDoc.rawResponse = { response: info.response, envelope: info.envelope };
            attemptDoc.attempts += 1;
            await attemptDoc.save();

            return { success: true, messageId: info.messageId };

        } catch (error) {
            console.error(`SMTP Send Error:`, error.message);
            // Transient vs Permanent classification. Very basic estimation:
            const isTransient = error.responseCode >= 400 && error.responseCode < 500;

            attemptDoc.attempts += 1;
            attemptDoc.lastError = error.message;

            // Worker handles maxRetries check, so we just return the error upwards
            await attemptDoc.save();
            throw error;
        }
    }
}

const mailerInstance = new MailerService();
// Bind the method so that destructuring works correctly
mailerInstance.sendEmail = mailerInstance.sendEmail.bind(mailerInstance);
mailerInstance.sendWithRetry = mailerInstance.sendWithRetry.bind(mailerInstance);
mailerInstance.sendVerificationEmail = mailerInstance.sendVerificationEmail.bind(mailerInstance);

module.exports = Object.assign(mailerInstance, { templates });
