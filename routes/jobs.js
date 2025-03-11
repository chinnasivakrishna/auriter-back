const express = require('express');
const router = express.Router();
const { 
  createJob, 
  getJobs, 
  getRecruiterJobs, 
  updateJob, 
  deleteJob,
  getJobById,
  generateJobDetails
} = require('../controllers/jobController');
const { protect } = require('../middleware/auth');

// Create a new job
router.post('/', protect, createJob);

// Generate job details with OpenAI
router.post('/generate-details', protect, generateJobDetails);

// Get all jobs (with filters)
router.get('/', getJobs);

// Get recruiter's jobs
router.get('/my-jobs', protect, getRecruiterJobs);

// Get job by ID
router.get('/:id', getJobById);

// Update job
router.patch('/:id', protect, updateJob);

// Delete job
router.delete('/:id', protect, deleteJob);

module.exports = router;