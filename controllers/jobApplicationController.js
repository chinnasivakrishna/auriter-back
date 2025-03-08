// controllers/jobApplicationController.js
const JobApplication = require('../models/JobApplication');
const Job = require('../models/Job');
const path = require('path');
const fs = require('fs');
const User = require('../models/User');
const { analyzeApplicationResume } = require('./applicationResumeController');
const ResumeAnalysis = require('../models/ResumeAnalysis');
// In jobApplicationController.js
exports.getAllCompanyApplications = async (req, res) => {
  try {
    // Get all jobs posted by the recruiter
    const recruiterJobs = await Job.find({ recruiter: req.user.id });
    const jobIds = recruiterJobs.map(job => job._id);

    // Get all applications for these jobs
    const applications = await JobApplication.find({
      job: { $in: jobIds }
    })
    .populate('applicant', 'name email')
    .populate('job', 'title company type')
    .sort({ createdAt: -1 });

    const applicationStats = {
      total: applications.length,
      pending: applications.filter(app => app.status === 'pending').length,
      reviewed: applications.filter(app => app.status === 'reviewed').length,
      shortlisted: applications.filter(app => app.status === 'shortlisted').length,
      rejected: applications.filter(app => app.status === 'rejected').length
    };

    res.json({
      applications,
      stats: applicationStats
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.searchApplications = async (req, res) => {
  try {
    const { searchTerm, status, jobType, dateRange } = req.query;
    
    // Get recruiter's jobs
    const recruiterJobs = await Job.find({ recruiter: req.user.id });
    const jobIds = recruiterJobs.map(job => job._id);

    // Build query
    let query = { job: { $in: jobIds } };

    // Add status filter if provided
    if (status && status !== 'all') {
      query.status = status;
    }

    // Add job type filter if provided
    if (jobType && jobType !== 'all') {
      const jobsOfType = recruiterJobs
        .filter(job => job.type === jobType)
        .map(job => job._id);
      query.job = { $in: jobsOfType };
    }

    // Add date range filter if provided
    if (dateRange) {
      const [start, end] = dateRange.split(',');
      if (start && end) {
        query.createdAt = {
          $gte: new Date(start),
          $lte: new Date(end)
        };
      }
    }

    // Get applications
    let applications = await JobApplication.find(query)
      .populate('applicant', 'name email')
      .populate('job', 'title company type')
      .sort({ createdAt: -1 });

    // Apply search term filter if provided
    if (searchTerm) {
      applications = applications.filter(app => 
        app.applicant.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        app.applicant.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        app.job.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        app.job.company.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    const stats = {
      total: applications.length,
      pending: applications.filter(app => app.status === 'pending').length,
      reviewed: applications.filter(app => app.status === 'reviewed').length,
      shortlisted: applications.filter(app => app.status === 'shortlisted').length,
      rejected: applications.filter(app => app.status === 'rejected').length
    };

    res.json({
      applications,
      stats
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getUserApplications = async (req, res) => {
  try {
    const applications = await JobApplication.find({ applicant: req.user.id })
      .populate('job', 'title company status')
      .sort({ createdAt: -1 });

    res.json(applications);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateApplicationStatus = async (req, res) => {
  try {
    const application = await JobApplication.findById(req.params.applicationId);
    
    if (!application) {
      return res.status(404).json({ message: 'Application not found' });
    }

    const job = await Job.findOne({
      _id: application.job,
      recruiter: req.user.id
    });

    if (!job) {
      return res.status(403).json({ message: 'Not authorized to update this application' });
    }

    application.status = req.body.status;
    await application.save();

    res.json(application);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.submitApplication = async (req, res) => {
  let uploadedFileName;
  
  try {
    const job = await Job.findById(req.params.jobId);
    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    if (job.status !== 'active') {
      return res.status(400).json({ message: 'This job is no longer accepting applications' });
    }

    const existingApplication = await JobApplication.findOne({
      job: req.params.jobId,
      applicant: req.user.id
    });

    if (existingApplication) {
      return res.status(400).json({ message: 'You have already applied for this job' });
    }

    if (!req.files || !req.files.resume) {
      return res.status(400).json({ message: 'Resume is required' });
    }

    const resumeFile = req.files.resume;
    const fileExt = path.extname(resumeFile.name);
    uploadedFileName = `${req.user.id}-${Date.now()}${fileExt}`;
    const uploadPath = path.join(__dirname, '../uploads/resumes', uploadedFileName);

    // Move the file to uploads directory
    await resumeFile.mv(uploadPath);

    // Create the job application
    const application = new JobApplication({
      job: req.params.jobId,
      applicant: req.user.id,
      resume: uploadedFileName,
      coverLetter: req.body.coverLetter,
      additionalNotes: req.body.additionalNotes
    });

    await application.save();

    // Create a response object that we'll build up
    const response = {
      success: true,
      application
    };

    // Try to analyze the resume
    try {
      // Modified to create a mock response object
      const mockRes = {
        json: (data) => data
      };

      const analysisResponse = await analyzeApplicationResume({
        body: {
          resumeUrl: uploadedFileName,
          jobId: req.params.jobId
        }
      }, mockRes);

      // If we got analysis data back, store it and add to response
      if (analysisResponse && analysisResponse.data) {
        const analysis = await ResumeAnalysis.create({
          application: application._id,
          feedback: analysisResponse.data.feedback,
          keyFindings: analysisResponse.data.keyFindings,
          suggestions: analysisResponse.data.suggestions
        });

        response.analysis = analysisResponse.data;
      }
    } catch (analysisError) {
      console.error('Resume analysis error:', analysisError);
      // Add a warning to the response but don't fail the application
      response.warning = 'Resume analysis service temporarily unavailable';
    }

    return res.status(201).json(response);

  } catch (error) {
    // Clean up uploaded file if there's an error
    if (uploadedFileName) {
      const uploadPath = path.join(__dirname, '../uploads/resumes', uploadedFileName);
      if (fs.existsSync(uploadPath)) {
        fs.unlinkSync(uploadPath);
      }
    }
    return res.status(400).json({ message: error.message });
  }
};


// Add new route to get analysis for an application
exports.getApplicationAnalysis = async (req, res) => {
  try {
    const analysis = await ResumeAnalysis.findOne({
      application: req.params.applicationId
    });

    if (!analysis) {
      return res.status(404).json({ message: 'Analysis not found' });
    }

    // Check if user has permission to view this analysis
    const application = await JobApplication.findById(req.params.applicationId)
      .populate('job');

    if (!application) {
      return res.status(404).json({ message: 'Application not found' });
    }

    // Allow access if user is the applicant or the job recruiter
    if (
      application.applicant.toString() !== req.user.id &&
      application.job.recruiter.toString() !== req.user.id
    ) {
      return res.status(403).json({ message: 'Not authorized to view this analysis' });
    }

    res.json(analysis);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

  exports.getApplicationsByJob = async (req, res) => {
    try {
      const applications = await JobApplication.find({ job: req.params.jobId })
        .populate('applicant', 'name email')
        .sort({ createdAt: -1 });
  
      res.json(applications);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  };