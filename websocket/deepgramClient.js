const WebSocket = require('ws');

class DeepgramClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.ws = null;
    this.onTranscript = null;
  }

  connect(options = {}) {
    return new Promise((resolve, reject) => {
      try {
        // Build URL with query parameters matching the desired format
        const wsUrl = new URL('wss://api.deepgram.com/v1/listen');
        wsUrl.searchParams.append('sample_rate', '16000');
        wsUrl.searchParams.append('channels', '1');
        wsUrl.searchParams.append('interim_results', 'true');
        wsUrl.searchParams.append('language', options.language || 'hi');
        wsUrl.searchParams.append('model', 'nova-2');

        // Connect with token in WebSocket protocol array
        this.ws = new WebSocket(wsUrl.toString(), ['token', this.apiKey]);

        this.ws.binaryType = 'arraybuffer';
        
        this.ws.onopen = () => {
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.channel?.alternatives?.[0]?.transcript) {
              const transcript = data.channel.alternatives[0].transcript;
              if (transcript.trim() && this.onTranscript) {
                this.onTranscript(transcript);
              }
            }
          } catch (parseError) {
            console.error('Error parsing Deepgram message:', parseError);
          }
        };

        this.ws.onerror = (error) => {
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('Deepgram connection closed');
        };

      } catch (error) {
        reject(error);
      }
    });
  }

  sendAudio(audioData) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        const buffer = audioData instanceof Buffer ? audioData : Buffer.from(audioData);
        this.ws.send(buffer);
      } catch (error) {
        console.error('Error sending audio data:', error);
      }
    }
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

module.exports = { DeepgramClient };