require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Company = require('./models/Company');
const bcrypt = require('bcrypt');

async function simulateRegistration() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const session = await mongoose.startSession();
        session.startTransaction();

        console.log("Simulating Registration...");

        const organizationName = "TechCorp Global Ultimate Test";
        const email = "testadmin@ultimate.com";
        const password = "password123";

        // Create User
        const newUser = new User({
            email,
            passwordHash: password,
            role: 'company_admin',
            status: 'pending',
            profile: { representativeName: "Test Name", phone: "123" }
        });

        // Create Company
        const newCompany = new Company({
            officialName: organizationName,
            country: "US",
            website: "https://test.com",
            companyEmail: email,
            numberOfEmployees: "51-200",
            industry: "Tech",
            fullAddress: "123 Way",
            representative: {
                user: newUser._id,
                name: "Test Name"
            },
            status: 'pending',
            verification: { emailVerified: true }
        });

        await newUser.save({ session });
        console.log("User saved successfully.");

        await newCompany.save({ session });
        console.log("Company saved successfully.");

        await session.commitTransaction();
        session.endSession();
        console.log("Transaction committed!");
    } catch (e) {
        console.error("SIMULATION ERROR: ", e);
    } finally {
        mongoose.disconnect();
    }
}

simulateRegistration();
