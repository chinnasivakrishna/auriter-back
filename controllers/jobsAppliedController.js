// controllers/jobsAppliedController.js
const JobApplication = require('../models/JobApplication');

exports.getMyApplications = async (req, res) => {
  try {
    const applications = await JobApplication.find({ applicant: req.user.id })
      .populate({
        path: 'job',
        select: 'title company location type status'
      })
      .sort({ createdAt: -1 });

    // Transform the data to include application statistics
    const transformedApplications = applications.map(app => {
      return {
        _id: app._id,
        job: {
          title: app.job.title,
          company: app.job.company,
          location: app.job.location,
          type: app.job.type,
          status: app.job.status
        },
        status: app.status,
        coverLetter: app.coverLetter,
        additionalNotes: app.additionalNotes,
        resume: app.resume,
        createdAt: app.createdAt,
        updatedAt: app.updatedAt
      };
    });

    // Calculate statistics
    const stats = {
      total: applications.length,
      pending: applications.filter(app => app.status === 'pending').length,
      reviewed: applications.filter(app => app.status === 'reviewed').length,
      shortlisted: applications.filter(app => app.status === 'shortlisted').length,
      accepted: applications.filter(app => app.status === 'accepted').length,
      rejected: applications.filter(app => app.status === 'rejected').length
    };

    res.json({
      applications: transformedApplications,
      stats
    });
  } catch (error) {
    res.status(500).json({ 
      message: 'Error fetching applications',
      error: error.message 
    });
  }
};

exports.getApplicationDetails = async (req, res) => {
  try {
    const application = await JobApplication.findOne({
      _id: req.params.id,
      applicant: req.user.id
    }).populate('job');

    if (!application) {
      return res.status(404).json({ message: 'Application not found' });
    }

    res.json(application);
  } catch (error) {
    res.status(500).json({ 
      message: 'Error fetching application details',
      error: error.message 
    });
  }
};