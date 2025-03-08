const express = require('express');
const router = express.Router();
const { 
  submitApplication,
  getApplicationsByJob,
  getUserApplications,
  updateApplicationStatus,
  getAllCompanyApplications,
  searchApplications,
  getApplicationAnalysis
} = require('../controllers/jobApplicationController');
const { protect } = require('../middleware/auth');

// Get all applications for the company
router.get('/company', protect, getAllCompanyApplications);
// Search and filter applications
router.get('/search', protect, searchApplications);

// Get applications for a specific job
router.get('/job/:jobId', protect, getApplicationsByJob);

// Get user's applications
router.get('/my-applications', protect, getUserApplications);

// Submit new application
router.post('/:jobId', protect, submitApplication);

// Update application status
router.patch('/:applicationId/status', protect, updateApplicationStatus);


router.get('/:applicationId/analysis', protect, getApplicationAnalysis);
module.exports = router;