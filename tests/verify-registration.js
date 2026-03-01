require('dotenv').config();
const mongoose = require('mongoose');

async function testQuery() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const users = mongoose.connection.db.collection('users');
        const companies = mongoose.connection.db.collection('companies');

        const user = await users.findOne({ email: 'admin@techcorpglobalsnewretry.com' });
        console.log('--- USER ---');
        console.log(user);

        if (user) {
            const company = await companies.findOne({ 'representative.user': user._id });
            console.log('\n--- COMPANY ---');
            console.log(company);

            // Activate the user explicitly for the second test flow
            await mongoose.connection.db.collection('companies').updateOne({ _id: company._id }, { $set: { status: 'verified' } });
            await users.updateOne({ _id: user._id }, { $set: { status: 'active' } });
            console.log('\n--- SIMULATED SUPER ADMIN APPROVAL COMPLETE ---');
        }
    } catch (e) {
        console.error(e);
    } finally {
        mongoose.disconnect();
    }
}

testQuery();
