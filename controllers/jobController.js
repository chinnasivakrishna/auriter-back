const JobApplication = require('../models/JobApplication');
const Job = require('../models/Job');
const { OpenAI } = require('openai');

// Initialize OpenAI with API key from environment variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

exports.generateJobDetails = async (req, res) => {
  try {
    const { title, company, type, location } = req.body;
    
    if (!title || !company || !type || !location) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Create a prompt for OpenAI
    const prompt = `
      Generate comprehensive details for a job posting with the following information:
      Job Title: ${title}
      Company: ${company}
      Job Type: ${type}
      Location: ${location}

      Please provide the following in a JSON format:
      1. A detailed job description (2-3 paragraphs)
      2. 5-7 job requirements as an array of strings
      3. 5-7 job responsibilities as an array of strings
      4. 5-8 required skills as an array of strings
      5. 3-5 benefits as an array of strings
      6. Recommended experience range (min and max in years)
      7. Suggested salary range (min and max in USD)

      Format the response as a JSON object with these exact keys:
      {
        "description": "string",
        "requirements": ["string"],
        "responsibilities": ["string"],
        "skills": ["string"],
        "benefits": ["string"],
        "experience": {"min": number, "max": number},
        "salary": {"min": number, "max": number, "currency": "USD"}
      }

      Return only valid JSON without code blocks or explanations.
    `;

    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: "gpt-4", // Use appropriate model
      messages: [
        {
          role: "system",
          content: "You are a professional job description writer who specializes in creating comprehensive, accurate job listings. Return only valid JSON with the exact keys requested, without markdown code blocks or explanations."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 1500
      // Removed the response_format parameter as it's not supported by this model
    });

    // Parse the response to get the generated job details
    let generatedContent;
    console.log("OpenAI response received");
    try {
      // Extract the JSON from the response
      const responseText = response.choices[0].message.content.trim();
      console.log("Raw response text:", responseText);
      
      // Try to parse the JSON, handling potential markdown code blocks
      let jsonText = responseText;
      
      // Remove markdown code block if present
      if (jsonText.startsWith("```json")) {
        jsonText = jsonText.replace(/```json\n/, "").replace(/\n```$/, "");
      } else if (jsonText.startsWith("```")) {
        jsonText = jsonText.replace(/```\n/, "").replace(/\n```$/, "");
      }
      
      generatedContent = JSON.parse(jsonText);
      
      // Add fallbacks for any missing fields
      generatedContent = {
        description: generatedContent.description || "",
        requirements: generatedContent.requirements || [],
        responsibilities: generatedContent.responsibilities || [],
        skills: generatedContent.skills || [],
        benefits: generatedContent.benefits || [],
        experience: generatedContent.experience || { min: 0, max: 0 },
        salary: generatedContent.salary || { min: 0, max: 0, currency: 'USD' }
      };
      
      console.log("Processed content:", generatedContent);
    } catch (parseError) {
      console.error("Error parsing OpenAI response:", parseError);
      return res.status(500).json({ message: 'Failed to parse AI response' });
    }

    // Send the generated content back to the client
    res.json(generatedContent);
  } catch (error) {
    console.error("Error generating job details:", error);
    res.status(500).json({ message: error.message || 'Failed to generate job details' });
  }
};

// Rest of the controller remains the same
exports.searchApplications = async (req, res) => {
  try {
    const { searchTerm, status, jobType } = req.query;
    
    // Get recruiter's jobs
    const recruiterJobs = await Job.find({ recruiter: req.user.id });
    const jobIds = recruiterJobs.map(job => job._id);

    // Build base query
    let query = { job: { $in: jobIds } };

    // Add status filter
    if (status && status !== 'all') {
      query.status = status;
    }

    // Add job type filter
    if (jobType && jobType !== 'all') {
      const jobsOfType = await Job.find({
        _id: { $in: jobIds },
        type: jobType
      }).select('_id');
      query.job = { $in: jobsOfType.map(job => job._id) };
    }

    // Get applications with populated fields
    let applications = await JobApplication.find(query)
      .populate('applicant', 'name email')
      .populate('job', 'title company type')
      .sort({ createdAt: -1 });

    // Apply search term filter if provided
    if (searchTerm) {
      const searchRegex = new RegExp(searchTerm, 'i');
      applications = applications.filter(app => 
        searchRegex.test(app.applicant.name) ||
        searchRegex.test(app.applicant.email) ||
        searchRegex.test(app.job.title) ||
        searchRegex.test(app.job.company)
      );
    }

    // Calculate statistics
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

exports.updateApplicationStatus = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const { status } = req.body;

    // Validate status
    const validStatuses = ['pending', 'reviewed', 'shortlisted', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status value' });
    }

    // Find application and check permissions
    const application = await JobApplication.findById(applicationId)
      .populate('job', 'recruiter');

    if (!application) {
      return res.status(404).json({ message: 'Application not found' });
    }

    // Check if the user is the recruiter for this job
    if (application.job.recruiter.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to update this application' });
    }

    // Update status
    application.status = status;
    await application.save();

    // Get updated statistics
    const recruiterJobs = await Job.find({ recruiter: req.user.id });
    const jobIds = recruiterJobs.map(job => job._id);
    
    const applications = await JobApplication.find({ job: { $in: jobIds } });
    
    const stats = {
      total: applications.length,
      pending: applications.filter(app => app.status === 'pending').length,
      reviewed: applications.filter(app => app.status === 'reviewed').length,
      shortlisted: applications.filter(app => app.status === 'shortlisted').length,
      rejected: applications.filter(app => app.status === 'rejected').length
    };

    res.json({
      application,
      stats
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createJob = async (req, res) => {
  try {
    const jobData = {
      ...req.body,
      recruiter: req.user.id
    };
    const job = new Job(jobData);
    await job.save();
    res.status(201).json(job);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.getJobs = async (req, res) => {
  try {
    const {
      search, location, type,
      experienceMin, experienceMax,
      salaryMin, salaryMax,
      skills, status
    } = req.query;

    let query = { status: 'active' };

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    if (location) query.location = { $regex: location, $options: 'i' };
    if (type) query.type = type;
    if (status) query.status = status;
    if (experienceMin) query['experience.min'] = { $gte: parseInt(experienceMin) };
    if (experienceMax) query['experience.max'] = { $lte: parseInt(experienceMax) };
    if (salaryMin) query['salary.min'] = { $gte: parseInt(salaryMin) };
    if (salaryMax) query['salary.max'] = { $lte: parseInt(salaryMax) };
    if (skills) {
      const skillsArray = skills.split(',').map(skill => skill.trim());
      query.skills = { $all: skillsArray };
    }

    const jobs = await Job.find(query)
      .populate('recruiter', 'name email company')
      .sort({ createdAt: -1 });

    res.json(jobs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getRecruiterJobs = async (req, res) => {
  try {
    const jobs = await Job.find({ recruiter: req.user.id })
      .sort({ createdAt: -1 });
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateJob = async (req, res) => {
  try {
    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, recruiter: req.user.id },
      req.body,
      { new: true, runValidators: true }
    );

    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    res.json(job);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

exports.deleteJob = async (req, res) => {
  try {
    const job = await Job.findOneAndDelete({
      _id: req.params.id,
      recruiter: req.user.id
    });

    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    res.json({ message: 'Job deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getJobById = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id)
      .populate('recruiter', 'name email company');
    
    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    res.json(job);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};