const JobApplication = require('../models/JobApplication');
const { createRoom } = require('../services/100msService');
const { sendEmail } = require('../services/emailService');
const { v4: uuidv4 } = require('uuid');
const InterviewResponse = require('../models/InterviewResponse');
const OpenAIService = require('../services/nvidiaService');
const Interview = require('../models/Interview');

exports.scheduleInterview = async (req, res) => {
  console.log('[Schedule Interview] Request received:', req.body);
  try {
    const { applicationId, document, date, time, questions } = req.body;

    const application = await JobApplication.findById(applicationId)
      .populate('applicant')
      .populate('job');

    if (!application) {
      return res.status(404).json({ message: 'Application not found' });
    }

    const roomId = uuidv4();
    const interviewLink = `http://localhost:3000/interview/${roomId}`;

    let interviewQuestions = questions;
    if (!interviewQuestions) {
      const jobDescription = application.job.description;
      const jobTitle = application.job.title;
      
      const prompt = `Generate 5 technical interview questions for a ${jobTitle} position. 
      The job description is: ${jobDescription}. 
      The questions should assess the candidate's technical skills, problem-solving abilities, and experience.
      Return the questions in a strict JSON array format: ["Question 1", "Question 2", "Question 3", "Question 4", "Question 5"]`;
      
      try {
        const aiResponse = await OpenAIService.generateText(prompt);
        interviewQuestions = JSON.parse(aiResponse);
      } catch (error) {
        console.error('[Schedule Interview] Error generating questions:', error);
        interviewQuestions = [
          "Tell me about yourself and your experience.",
          "What are your strengths and weaknesses?",
          "Describe a challenging project you've worked on.",
          "How do you handle stress and pressure?",
          "Why are you interested in this position?"
        ];
      }
    }

    const interview = new Interview({
      roomId,
      date,
      time,
      document,
      jobTitle: application.job.title,
      applicantEmail: application.applicant.email,
      questions: interviewQuestions
    });
    await interview.save();

    await sendEmail({
      to: application.applicant.email,
      subject: 'Mock Interview Invitation',
      text: `You have been invited for a mock interview for the position of ${application.job.title}. Please join the room on ${date} at ${time}.`,
      interviewLink,
    });

    res.json({
      success: true,
      message: 'Interview scheduled successfully!',
      interviewLink,
      questions: interviewQuestions
    });
  } catch (error) {
    console.error('[Schedule Interview] Error:', error);
    res.status(500).json({ message: error.message });
  }
};

exports.getInterviewDetails = async (req, res) => {
  console.log('[Get Interview Details] Request received for room ID:', req.params.roomId);
  try {
    const { roomId } = req.params;

    const interview = await Interview.findOne({ roomId });
    if (!interview) {
      console.error('[Get Interview Details] Interview not found for room ID:', roomId);
      return res.status(404).json({ message: 'Interview not found' });
    }

    console.log('[Get Interview Details] Interview details fetched:', interview);
    res.json({
      date: interview.date,
      time: interview.time,
      jobTitle: interview.jobTitle,
      document: interview.document
    });
  } catch (error) {
    console.error('[Get Interview Details] Error:', error);
    res.status(500).json({ message: error.message });
  }
};

exports.getInterviewQuestions = async (req, res) => {
  console.log('[Get Interview Questions] Request received for room ID:', req.params.roomId);
  try {
    const { roomId } = req.params;
    
    const interview = await Interview.findOne({ roomId });
    
    if (!interview) {
      console.error('[Get Interview Questions] Interview not found for room ID:', roomId);
      return res.status(404).json({ message: 'Interview not found' });
    }

    let generatedQuestions = [];
    if (interview.questions && interview.questions.length > 0) {
      console.log('[Get Interview Questions] Questions found:', interview.questions);
      generatedQuestions = interview.questions;
    } else {
      if (interview.document) {
        try {
          const prompt = `Extract the most relevant interview questions from the following document. 
          Focus on extracting 15 high-quality, varied questions that cover technical skills, problem-solving, and soft skills:

${interview.document}

Return the questions in a strict JSON array format. Do not include any additional text or explanations. Example format:
[
  "Question 1",
  "Question 2",
  "Question 3",
  "Question 4",
  "Question 5"
]`;

          const aiResponse = await OpenAIService.generateText(prompt);

          // Extract JSON from the response
          let jsonResponse;
          try {
            // Remove any non-JSON content (e.g., <think> blocks)
            const jsonMatch = aiResponse.match(/\[.*\]/s); // Match the JSON array
            if (!jsonMatch) {
              throw new Error('No valid JSON array found in response');
            }
            jsonResponse = JSON.parse(jsonMatch[0]);
          } catch (jsonError) {
            console.error('[Get Interview Questions] Invalid JSON response from OpenAI API:', aiResponse);
            throw new Error('Invalid JSON response from OpenAI API');
          }

          generatedQuestions = jsonResponse;

          if (generatedQuestions.length < 3) {
            const documentQuestions = interview.document
              .split('\n')
              .filter(line => 
                line.match(/^\d+[\).]?\s*[A-Z]/) &&
                line.trim().length > 20 &&
                line.toLowerCase().includes('how') || 
                line.toLowerCase().includes('what') || 
                line.toLowerCase().includes('describe')
              )
              .map(q => q.replace(/^\d+[\).]?\s*/, '').trim())
              .slice(0, 5);

            generatedQuestions = documentQuestions.length > 0 
              ? documentQuestions 
              : generatedQuestions;
          }

          interview.questions = generatedQuestions;
          await interview.save();

        } catch (error) {
          console.error('[Get Interview Questions] Error generating questions:', error);
          generatedQuestions = [
            "Tell me about a challenging technical project you've worked on.",
            'How do you approach problem-solving in software development?',
            'Describe your experience with modern web development technologies.',
            'What strategies do you use to learn and adapt to new technologies?',
            'How do you ensure code quality and maintainability?'
          ];
        }
      } else {
        generatedQuestions = [
          "Tell me about your technical background and experience.",
          "What are your strongest technical skills?",
          "Describe a complex problem you've solved.",
          "How do you approach learning new technologies?",
          "What motivates you in your professional development?"
        ];
      }
    }

    // Add normal interview questions
    const normalQuestions = [
      "Tell me about yourself.",
      "What are your strengths and weaknesses?",
      "Why do you want to work for this company?",
      "Where do you see yourself in 5 years?",
      "How do you handle stress and pressure?"
    ];

    // Combine technical and normal questions
    const allQuestions = [...normalQuestions, ...generatedQuestions];

    console.log('[Get Interview Questions] Returning questions:', allQuestions);
    res.json({ questions: allQuestions });

  } catch (error) {
    console.error('[Get Interview Questions] Error:', error);
    res.status(500).json({ message: error.message });
  }
};

exports.submitResponse = async (req, res) => {
  console.log('[Submit Response] Request received for room ID:', req.params.roomId);
  try {
    const { roomId } = req.params;
    const { question, response } = req.body;
    
    await InterviewResponse.create({
      roomId,
      question,
      response,
    });
    
    console.log('[Submit Response] Response saved for room ID:', roomId);
    res.json({ success: true, message: 'Response submitted successfully!' });
  } catch (error) {
    console.error('[Submit Response] Error:', error);
    res.status(500).json({ message: error.message });
  }
};

exports.analyzeResponses = async (req, res) => {
  try {
    const { roomId, questions, answers } = req.body;

    // Ensure questions and answers are defined
    if (!questions || !answers) {
      throw new Error('Questions or answers are missing in the request body.');
    }

    const analysisPrompt = `PROVIDE A VALID JSON RESPONSE EXACTLY MATCHING THIS STRUCTURE:
{
  "overallScores": {
    "selfIntroduction": 7,
    "projectExplanation": 7,
    "englishCommunication": 7
  },
  "feedback": {
    "selfIntroduction": {
      "strengths": "Detailed feedback on strengths",
      "areasOfImprovement": "Detailed feedback on areas to improve"
    },
    "projectExplanation": {
      "strengths": "Detailed feedback on strengths",
      "areasOfImprovement": "Detailed feedback on areas to improve"
    },
    "englishCommunication": {
      "strengths": "Detailed feedback on strengths",
      "areasOfImprovement": "Detailed feedback on areas to improve"
    }
  },
  "focusAreas": [
    "Key area to focus on for improvement",
    "Another area to focus on for improvement",
    "Third most important area to focus on"
  ]
}

INTERVIEW DATA:
${questions.map((q, i) => `Question ${i + 1}: ${q}\nResponse: ${answers[i]}`).join('\n\n')}

INSTRUCTIONS:
- Respond ONLY with the JSON
- Ensure valid JSON syntax
- Scores should be between 1-10
- Evaluate the candidate holistically across all answers
- For Self Introduction: Assess how well they presented their background, skills, and career goals
- For Project Explanation: Evaluate their ability to explain technical projects clearly and highlight their contributions
- For English Communication: Assess overall fluency, grammar, vocabulary, and clarity across all answers
- In focusAreas, list 3-5 specific, actionable improvement areas ordered by priority`;

    const aiResponse = await OpenAIService.generateText(analysisPrompt);

    let parsedAnalysis;
    try {
      // Extract JSON from the response
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/s);
      if (!jsonMatch) {
        console.error('No valid JSON found in response:', aiResponse);
        throw new Error('No valid JSON object found');
      }

      // Parse the JSON
      parsedAnalysis = JSON.parse(jsonMatch[0]);

      // Validate and ensure the structure is correct
      if (!parsedAnalysis.overallScores || !parsedAnalysis.feedback || !parsedAnalysis.focusAreas) {
        throw new Error('Invalid analysis structure');
      }

      // Ensure we have all required scores and feedback sections
      const requiredFields = ['selfIntroduction', 'projectExplanation', 'englishCommunication'];
      
      for (const field of requiredFields) {
        // Check and set default scores if missing
        if (!parsedAnalysis.overallScores[field]) {
          parsedAnalysis.overallScores[field] = 5;
        }
        
        // Check and set default feedback if missing
        if (!parsedAnalysis.feedback[field]) {
          parsedAnalysis.feedback[field] = {
            strengths: 'Unable to generate detailed feedback',
            areasOfImprovement: 'Unable to generate detailed feedback'
          };
        } else {
          // Ensure the feedback has both strengths and areas of improvement
          if (!parsedAnalysis.feedback[field].strengths) {
            parsedAnalysis.feedback[field].strengths = 'Unable to generate detailed feedback';
          }
          if (!parsedAnalysis.feedback[field].areasOfImprovement) {
            parsedAnalysis.feedback[field].areasOfImprovement = 'Unable to generate detailed feedback';
          }
        }
      }

      // Ensure focusAreas is an array with at least 3 items
      if (!Array.isArray(parsedAnalysis.focusAreas) || parsedAnalysis.focusAreas.length < 1) {
        parsedAnalysis.focusAreas = [
          "Improve communication clarity and structure",
          "Enhance technical explanation skills",
          "Work on presentation of self-introduction"
        ];
      }

    } catch (parseError) {
      console.error('Parsing error:', parseError);
      console.error('Problematic response:', aiResponse);

      // Fallback to a default analysis structure
      parsedAnalysis = {
        overallScores: {
          selfIntroduction: 5,
          projectExplanation: 5,
          englishCommunication: 5
        },
        feedback: {
          selfIntroduction: {
            strengths: 'Unable to generate detailed feedback',
            areasOfImprovement: 'Unable to generate detailed feedback'
          },
          projectExplanation: {
            strengths: 'Unable to generate detailed feedback',
            areasOfImprovement: 'Unable to generate detailed feedback'
          },
          englishCommunication: {
            strengths: 'Unable to generate detailed feedback',
            areasOfImprovement: 'Unable to generate detailed feedback'
          }
        },
        focusAreas: [
          "Improve communication clarity and structure",
          "Enhance technical explanation skills",
          "Work on presentation of self-introduction"
        ]
      };
    }

    // Logging for debugging
    console.log('Final Analysis:', JSON.stringify(parsedAnalysis, null, 2));

    res.json({ analysis: parsedAnalysis });

  } catch (error) {
    console.error('Analysis Error:', error);
    res.status(500).json({
      message: 'Analysis failed',
      analysis: {
        overallScores: {
          selfIntroduction: 5,
          projectExplanation: 5,
          englishCommunication: 5
        },
        feedback: {
          selfIntroduction: {
            strengths: 'Unable to generate analysis',
            areasOfImprovement: 'Unable to generate analysis'
          },
          projectExplanation: {
            strengths: 'Unable to generate analysis',
            areasOfImprovement: 'Unable to generate analysis'
          },
          englishCommunication: {
            strengths: 'Unable to generate analysis',
            areasOfImprovement: 'Unable to generate analysis'
          }
        },
        focusAreas: [
          "Improve oral communication skills",
          "Structure technical explanations more clearly",
          "Develop more comprehensive self-introduction"
        ]
      }
    });
  }
};