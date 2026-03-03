require('dotenv').config();
const mongoose = require('mongoose');
const PortfolioItem = require('./src/models/PortfolioItem');

mongoose.connect(process.env.MONGO_URI).then(async () => {
    const items = await PortfolioItem.find().sort({ createdAt: -1 }).limit(5);
    console.log(JSON.stringify(items.map(i => ({
        id: i._id,
        title: i.title,
        coverImage: i.coverImage,
        hasFileId: !!i.fileId
    })), null, 2));
    process.exit();
}).catch(err => {
    console.error(err);
    process.exit(1);
});
