const express = require('express');
const router = express.Router();
const {
  scheduleInterview,
  getInterviewDetails,
  getInterviewQuestions,
  submitResponse,
  analyzeResponses,
} = require('../controllers/interviewController');

// Ensure all route handlers are defined
router.post('/schedule', scheduleInterview);
router.get('/details/:roomId', getInterviewDetails);
router.get('/questions/:roomId', getInterviewQuestions);
router.post('/response/:roomId', submitResponse);
router.post('/analyze', analyzeResponses);

module.exports = router;