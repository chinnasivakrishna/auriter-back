const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, JWT_SECRET } = require('../auth/config');

const AdminProfile = require('../models/AdminProfile');
const { protect } = require('../middleware/auth');
// Passport Google Strategy
passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: "http://localhost:5000/api/auth/google/callback"
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await User.findOne({ googleId: profile.id });
      
      if (!user) {
        user = await User.create({
          googleId: profile.id,
          name: profile.displayName,
          email: profile.emails[0].value,
          password: 'googleAuth' // You might want to handle this differently
        });
      }
      
      return done(null, user);
    } catch (error) {
      return done(error, null);
    }
  }
));

// Helper function to generate JWT
const generateToken = (id) => {
  return jwt.sign({ id }, JWT_SECRET, {
    expiresIn: '30d'
  });
};

router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({
        success: false,
        message: 'User already exists'
      });
    }

    user = await User.create({
      name,
      email,
      password,
      role: 'jobSeeker'
    });

    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      token,
      requiresRole: true
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

router.post('/set-role', protect, async (req, res) => {
  try {
    const { role, company } = req.body;
    
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.role = role;
    
    if (role === 'recruiter' && company) {
      const adminProfile = new AdminProfile({
        user: user._id,
        companyName: company.name,
        position: company.position,
        website: company.website,
        isComplete: true
      });
      await adminProfile.save();
    }

    await user.save();

    res.json({
      success: true,
      role: user.role
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const token = generateToken(user._id);

    res.json({
      success: true,
      token,
      role: user.role
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Google OAuth routes
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get('/google/callback',
  passport.authenticate('google', { session: false }),
  (req, res) => {
    const token = generateToken(req.user._id);
    res.redirect(`https://auriter-front.vercel.app/auth/callback?token=${token}`);
  }
);

router.post('/get-token', protect, async (req, res) => {
  try {
    const { roomId, role } = req.body;
    
    // Generate a token with the roomId and role embedded
    const token = jwt.sign({ roomId, role }, JWT_SECRET, {
      expiresIn: '1h' // Token expires in 1 hour
    });

    res.json({
      success: true,
      token
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;