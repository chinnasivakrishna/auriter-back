const express = require('express');
const router = express.Router();
const Chat = require('../models/Chat');
const OpenAI = require('openai');
const { LMNTStreamingClient } = require('../websocket/lmntStreaming');

const fs = require('fs');
const path = require('path');
// Initialize NVIDIA AI (using OpenAI compatible client)
const nvidiAI = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1'
});

// Save recording endpoint
router.post('/save-recording', async (req, res) => {
  try {
    if (!req.files || !req.files.audio) {
      return res.status(400).json({ error: 'No audio file uploaded' });
    }

    const audioFile = req.files.audio;
    const userId = req.body.userId;
    
    // Create directory if it doesn't exist
    const uploadDir = path.join(__dirname, '../uploads/recordings');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Generate unique filename
    const filename = `recording_${userId}_${Date.now()}.webm`;
    const filepath = path.join(uploadDir, filename);

    // Save file
    await audioFile.mv(filepath);

    // Update chat document with recording information
    const chat = await Chat.findOne({ userId });
    if (chat) {
      chat.messages[chat.messages.length - 1].audioFile = filename;
      await chat.save();
    }

    res.json({ 
      success: true, 
      filename,
      message: 'Recording saved successfully' 
    });
    
  } catch (error) {
    console.error('Error saving recording:', error);
    res.status(500).json({ 
      error: 'Failed to save recording',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get chat history
router.get('/history/:userId', async (req, res) => {
  try {
    const chats = await Chat.find({ userId: req.params.userId })
      .sort({ updatedAt: -1 })
      .limit(10);
    res.json(chats);
  } catch (error) {
    console.error('Error fetching chat history:', error);
    res.status(500).json({ message: error.message });
  }
});

// Text-to-speech synthesis endpoint
router.post('/synthesize', async (req, res) => {
  try {
    const {
      text,
      voice = 'lily',
      model = 'aurora',
      format = 'mp3',
      language = 'en',
      sample_rate = 16000,
      speed = 1.0
    } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    if (!process.env.LMNT_API_KEY) {
      console.error('LMNT API key is missing from environment variables');
      return res.status(500).json({ error: 'LMNT API key not configured' });
    }

    console.log('Initializing LMNT client...');
    const lmntClient = new LMNTStreamingClient(process.env.LMNT_API_KEY);

    console.log('Connecting to LMNT service...');
    await lmntClient.connect({
      voice,
      model,
      format,
      language,
      sample_rate,
      speed
    });

    console.log('Synthesizing text...');
    const audioBuffer = await lmntClient.synthesize(text);

    console.log('Synthesis complete, sending response...');
    lmntClient.close();

    // Set appropriate headers
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Cache-Control': 'no-cache'
    });

    // Send the audio data
    res.send(audioBuffer);

  } catch (error) {
    console.error('Text-to-speech synthesis error:', error);
    res.status(500).json({ 
      error: 'Failed to synthesize speech',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Process message and get AI response
router.post('/message', async (req, res) => {
  try {
    console.log('=== Processing Chat Message ===');
    const { userId, message, language = 'en' } = req.body;
    console.log('Message Details:', { userId, language, messageLength: message.length });

    let chat = await Chat.findOne({ userId });
    if (!chat) {
      chat = new Chat({ userId, messages: [] });
      console.log('Creating new chat for user:', userId);
    } else {
      console.log('Found existing chat, messages count:', chat.messages.length);
    }

    chat.messages.push({
      content: message,
      isUser: true,
      timestamp: new Date(),
      language: language
    });

    // Define system prompts for different languages
    const systemPrompts = {
      'en': 'You are a helpful assistant.',
      'hi': 'आप एक सहायक सहायक हैं।',
      // Add more language-specific system prompts as needed
    };

    console.log('Starting NVIDIA AI request with model: deepseek-ai/deepseek-r1');
    try {
      const completion = await nvidiAI.chat.completions.create({
        model: "deepseek-ai/deepseek-r1",
        messages: [
          { role: "system", content: systemPrompts[language] || systemPrompts['en'] },
          { role: "user", content: message }
        ],
        temperature: 0.6,
        top_p: 0.7,
        max_tokens: 500,
        stream: false
      });

      console.log('NVIDIA AI response received');
      const aiResponse = completion.choices[0].message.content;

      chat.messages.push({
        content: aiResponse,
        isUser: false,
        timestamp: new Date(),
        language: language
      });

      chat.updatedAt = Date.now();
      await chat.save();
      console.log('Chat updated and saved to database');

      res.json({
        message: aiResponse,
        chatHistory: chat.messages
      });
    } catch (nvidiError) {
      console.error('NVIDIA API error:', nvidiError);

      // Handle rate limiting specifically
      if (nvidiError.status === 429) {
        return res.status(429).json({
          success: false,
          message: 'Chat service temporarily unavailable. Please try again in a few minutes.',
          retryAfter: 60
        });
      }

      // Provide fallback response if API fails
      const fallbackResponse = "I'm sorry, I'm unable to process your request right now. Please try again later.";
      chat.messages.push({
        content: fallbackResponse,
        isUser: false,
        timestamp: new Date(),
        language: language
      });

      chat.updatedAt = Date.now();
      await chat.save();
      console.log('Saved fallback response to chat');

      res.json({
        message: fallbackResponse,
        chatHistory: chat.messages,
        warning: 'Using fallback response due to service limitations'
      });
    }
  } catch (error) {
    console.error('Error processing message:', error);
    res.status(500).json({ 
      message: error.message,
      error: 'Failed to process message',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Delete chat history
router.delete('/history/:userId', async (req, res) => {
  try {
    await Chat.deleteMany({ userId: req.params.userId });
    res.json({ message: 'Chat history deleted successfully' });
  } catch (error) {
    console.error('Error deleting chat history:', error);
    res.status(500).json({ message: error.message });
  }
});

const languageConfig = {
  'en': {
    systemPrompt: 'You are a helpful assistant. Respond in English.',
    defaultVoice: 'lily'
  },
  'hi': {
    systemPrompt: 'आप एक सहायक सहायक हैं। हिंदी में जवाब दें।',
    defaultVoice: 'lily'
  }
};

// Voice message processing route with improved language handling
router.post('/voice-message', async (req, res) => {
  try {
    console.log('=== Processing Voice Message ===');
    const { userId, message, language = 'en', isVoiceInteraction = true } = req.body;
    console.log('Voice Message Details:', { userId, language, messageLength: message.length });

    // Initialize LMNT client for speech synthesis
    if (!process.env.LMNT_API_KEY) {
      throw new Error('LMNT API key not configured');
    }

    const lmntClient = new LMNTStreamingClient(process.env.LMNT_API_KEY);

    // Get language-specific configuration
    const langConfig = languageConfig[language] || languageConfig.en;
    console.log('Using language config:', langConfig);

    let chat = await Chat.findOne({ userId, isVoiceInteraction });
    if (!chat) {
      chat = new Chat({ userId, messages: [], isVoiceInteraction });
      console.log('Creating new voice chat for user:', userId);
    } else {
      console.log('Found existing voice chat, messages count:', chat.messages.length);
    }

    // Add user message to chat history
    chat.messages.push({
      content: message,
      isUser: true,
      timestamp: new Date(),
      language: language
    });

    // Get NVIDIA AI completion with language-specific system prompt
    console.log('Starting NVIDIA AI request with model: deepseek-ai/deepseek-r1');
    try {
      const completion = await nvidiAI.chat.completions.create({
        model: "deepseek-ai/deepseek-r1",
        messages: [
          { 
            role: "system", 
            content: langConfig.systemPrompt 
          },
          { 
            role: "user", 
            content: message 
          }
        ],
        temperature: 0.6,
        top_p: 0.7,
        max_tokens: 500,
        stream: false
      });

      console.log('NVIDIA AI response received');
      const aiResponse = completion.choices[0].message.content;

      // Add AI response to chat history
      chat.messages.push({
        content: aiResponse,
        isUser: false,
        timestamp: new Date(),
        language: language
      });

      chat.updatedAt = Date.now();
      await chat.save();
      console.log('Voice chat updated and saved to database');

      // Configure synthesis options based on language
      const synthesisOptions = {
        voice: langConfig.defaultVoice,
        language: language,
        speed: 1.0,
        format: 'mp3',
        sample_rate: 16000
      };

      console.log('Synthesis options:', synthesisOptions);

      // Get audio data for the response
      const audioBuffer = await lmntClient.synthesize(aiResponse, synthesisOptions);
      console.log('Speech synthesis completed, buffer size:', audioBuffer.length);

      res.json({
        message: aiResponse,
        chatHistory: chat.messages,
        audio: audioBuffer.toString('base64'),
        synthesisOptions: synthesisOptions
      });
    } catch (nvidiError) {
      console.error('NVIDIA API error:', nvidiError);

      // Handle rate limiting specifically
      if (nvidiError.status === 429) {
        return res.status(429).json({
          success: false,
          message: 'Voice chat service temporarily unavailable. Please try again in a few minutes.',
          retryAfter: 60
        });
      }

      // Provide fallback response if API fails
      const fallbackResponse = "I'm sorry, I'm unable to process your voice request right now. Please try again later.";
      chat.messages.push({
        content: fallbackResponse,
        isUser: false,
        timestamp: new Date(),
        language: language
      });

      chat.updatedAt = Date.now();
      await chat.save();
      console.log('Saved fallback response to voice chat');

      // Configure synthesis options based on language
      const synthesisOptions = {
        voice: langConfig.defaultVoice,
        language: language,
        speed: 1.0,
        format: 'mp3',
        sample_rate: 16000
      };

      // Get audio data for the fallback response
      const audioBuffer = await lmntClient.synthesize(fallbackResponse, synthesisOptions);

      res.json({
        message: fallbackResponse,
        chatHistory: chat.messages,
        audio: audioBuffer.toString('base64'),
        synthesisOptions: synthesisOptions,
        warning: 'Using fallback response due to service limitations'
      });
    }
  } catch (error) {
    console.error('Error processing voice message:', error);
    res.status(500).json({ 
      message: error.message,
      error: 'Failed to process voice message',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Get voice chat history
router.get('/voice-history/:userId', async (req, res) => {
  try {
    const chats = await Chat.find({ 
      userId: req.params.userId,
      isVoiceInteraction: true 
    })
    .sort({ updatedAt: -1 })
    .limit(10);
    res.json(chats);
  } catch (error) {
    console.error('Error fetching voice chat history:', error);
    res.status(500).json({ message: error.message });
  }
});

// Add transcription endpoint for handling audio file uploads
router.post('/transcribe', async (req, res) => {
  try {
    console.log('=== Starting Transcription ===');
    if (!req.files || !req.files.audio) {
      console.error('No audio file found in request');
      return res.status(400).json({ error: 'No audio file uploaded' });
    }

    const audioFile = req.files.audio;
    console.log('Audio File Details:', {
      name: audioFile.name,
      size: audioFile.size,
      mimetype: audioFile.mimetype
    });
    
    // Use NVIDIA's compatible API for transcription
    try {
      console.log('Starting NVIDIA AI transcription request');
      const transcription = await nvidiAI.audio.transcriptions.create({
        file: audioFile.tempFilePath,
        model: "whisper-1",
      });

      console.log('Transcription completed successfully');
      res.json({ transcript: transcription.text });
    } catch (nvidiError) {
      console.error('NVIDIA API transcription error:', nvidiError);

      // Handle rate limiting specifically
      if (nvidiError.status === 429) {
        return res.status(429).json({
          success: false,
          message: 'Transcription service temporarily unavailable. Please try again in a few minutes.',
          retryAfter: 60
        });
      }

      // Provide fallback response if API fails
      return res.status(503).json({ 
        error: 'Transcription service temporarily unavailable',
        details: 'Please try again later'
      });
    }
    
  } catch (error) {
    console.error('Transcription error:', error);
    res.status(500).json({ 
      error: 'Failed to transcribe audio',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;