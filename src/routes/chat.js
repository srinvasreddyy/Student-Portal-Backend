const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { authenticate } = require('../middleware/authMiddleware');
const upload = require('../middleware/fileUpload');

// Example usage: 
// GET /projects/:id/messages?page=1&limit=50&before=<cursor>
// POST /projects/:id/messages/:messageId/attachments
// GET /chat/files/:fileId
// GET /projects/:id/rooms

router.use(authenticate); // Require authentication for all chat routes

// Pagination for room messages
router.get('/projects/:id/messages', chatController.getMessages);

// List rooms a user is a member of
router.get('/rooms', chatController.getRooms);

// Attachment upload (using multer middleware, max size and mime types handled there)
router.post('/projects/:id/messages/:messageId/attachments', upload, chatController.uploadAttachment);

// Download streaming
router.get('/files/:fileId', chatController.downloadFile);

// Delete message
router.delete('/projects/:id/messages/:messageId', chatController.deleteMessage);

module.exports = router;
