const mongoose = require('mongoose');
const Project = require('./src/models/Project');
const Company = require('./src/models/Company');

mongoose.connect('mongodb://localhost:27017/student_app_dev', { useNewUrlParser: true, useUnifiedTopology: true })
    .then(async () => {
        const project = await Project.findOne();
        console.log("Project postedBy:", project.postedBy);
        console.log("Project postedByModel:", project.postedByModel);

        const company = await Company.findOne();
        console.log("Company ID:", company ? company._id : 'None');
        console.log("Company Rep User:", company ? company.representative.user : 'None');

        process.exit(0);
    });
