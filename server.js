// In your server.js or index.js file on the Render backend
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Set up Socket.IO with proper CORS configuration
const io = new Server(server, {
  cors: {
    origin: [
      "https://www.degenswim.tv", 
      "https://nextjs-degen.vercel.app",
      "http://localhost:3000"  // For local development
    ],
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Your socket event handlers go here
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Rest of your socket code...
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});