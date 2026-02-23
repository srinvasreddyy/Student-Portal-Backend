const mongoose = require('mongoose');

// Optional lightweight metadata model to maintain state beyond the core project
const chatRoomSchema = new mongoose.Schema({
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, unique: true },
    roomName: { type: String, trim: true },
    participantsCache: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // Optional denormalized for faster ACL checks
}, { timestamps: true });


module.exports = mongoose.model('ChatRoom', chatRoomSchema);
