// In your server.js or index.js file on the Render backend
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { randomUUID } = require('crypto');

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

// Store user information
/** @type {Object.<string, string>} */
const userAddresses = {};

/** @type {Object.<string, string>} */
const usernames = {};

/** @type {Object.<string, boolean>} */
const userBadges = {};

/** @type {Set<string>} */
const sentMessages = new Set();

// Chat room constants
const CHAT_ROOMS = {
  NORMAL: 'chat-normal',
  VIP: 'chat-vip'
};

/**
 * Helper function to normalize chat type
 * @param {string} inputChatType - The input chat type
 * @returns {'normal'|'vip'} Normalized chat type
 */
function normalizeChatType(inputChatType) {
  if (inputChatType && inputChatType.toLowerCase() === 'vip') {
    return 'vip';
  }
  return 'normal';
}

/**
 * Helper function to get chat room name
 * @param {'normal'|'vip'} chatType - The chat type
 * @returns {string} The room name
 */
function getChatRoom(chatType) {
  return chatType === 'vip' ? CHAT_ROOMS.VIP : CHAT_ROOMS.NORMAL;
}

// Your socket event handlers go here
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('error', (err) => {
    console.error('Socket error:', err);
  });

  /**
   * Handle join chat event
   * @param {string} username - User's display name
   * @param {string} [address=''] - User's wallet address
   * @param {string} [inputChatType='normal'] - Chat type to join
   */
  socket.on('join-chat', (username, address = '', inputChatType = 'normal') => {
    // Normalize the chat type
    const chatType = normalizeChatType(inputChatType);
    const roomName = getChatRoom(chatType);
    
    console.log(`${username} joining the ${chatType} chat (${roomName}) with address: ${address}`);
    
    // Store user information
    if (address) {
      userAddresses[socket.id] = address.toLowerCase();
    }
    
    // Store username
    usernames[socket.id] = username;
    
    // Join the room
    socket.join(roomName);
    
    // If we already know this user has a badge, emit it
    if (address && userBadges[address.toLowerCase()]) {
      io.emit('badge-update', address.toLowerCase(), true);
      console.log(`Re-emitting badge for returning user: ${address.toLowerCase()}`);
    }
  });

  /**
   * Handle sending messages
   * @param {string} message - The message content
   * @param {string} username - User's display name
   * @param {string} [address=''] - User's wallet address
   * @param {string} [inputChatType='normal'] - Chat type to send to
   */
  socket.on('send-message', (message, username, address = '', inputChatType = 'normal') => {
    // Normalize the chat type
    const chatType = normalizeChatType(inputChatType);
    const roomName = getChatRoom(chatType);
    
    console.log(`Message from ${username} to ${chatType} chat (${roomName}):`, message);
    
    // Store or update the user's address
    if (address) {
      userAddresses[socket.id] = address.toLowerCase();
    }
    
    // Get the stored address or use the provided one
    const userAddress = userAddresses[socket.id] || address;
    
    // For VIP chat, verify user has a badge
    if (chatType === 'vip') {
      const hasBadge = userBadges[userAddress?.toLowerCase()] || false;
      if (!hasBadge) {
        console.log(`User ${username} tried to send to VIP chat but doesn't have a badge`);
        // Send a private error message
        socket.emit('new-message', {
          id: 'system',
          message: 'You need a diamond badge to send messages to the VIP chat',
          username: 'System',
          timestamp: new Date().toISOString(),
          messageId: `system-${Date.now()}-${randomUUID()}`,
          chatType: 'normal'
        }, 'normal');
        return;
      }
    }
    
    // Create a unique message ID to prevent duplicates
    const timestamp = new Date().toISOString();
    const messageId = `${userAddress || socket.id}-${timestamp}-${message}-${chatType}`;
    
    // Check if we've already sent this message
    if (!sentMessages.has(messageId)) {
      sentMessages.add(messageId);
      
      // Create the message object
      const messageObj = {
        id: userAddress || socket.id, // Use address as ID when available
        message,
        username,
        timestamp,
        messageId,
        chatType
      };
      
      // Send to appropriate chat room
      io.to(roomName).emit('new-message', messageObj, chatType);
      
      // Clean up old message IDs to prevent memory leaks
      setTimeout(() => {
        sentMessages.delete(messageId);
      }, 10000); // Remove after 10 seconds
    }
  });

  /**
   * Handle badge updates
   * @param {string} address - User's wallet address
   * @param {boolean} hasBadge - Whether the user has a badge
   */
  socket.on('badge-update', (address, hasBadge) => {
    if (!address) return;
    
    const normalizedAddress = address.toLowerCase();
    
    // Store the badge status for this address
    userBadges[normalizedAddress] = hasBadge;
    
    // Only emit badge updates once per address
    const badgeEventId = `badge-${normalizedAddress}-${hasBadge}-${Date.now()}`;
    if (!sentMessages.has(badgeEventId)) {
      sentMessages.add(badgeEventId);
      
      // Broadcast badge update to all clients
      io.emit('badge-update', normalizedAddress, hasBadge);
      
      // If user just got VIP status, let them know and add them to VIP room
      if (hasBadge) {
        // Find all sockets belonging to this address
        for (const [socketId, storedAddress] of Object.entries(userAddresses)) {
          if (storedAddress === normalizedAddress) {
            const socketClient = io.sockets.sockets.get(socketId);
            if (socketClient) {
              // Join the VIP room
              socketClient.join(CHAT_ROOMS.VIP);
              
              // Send a welcome message to the VIP chat
              socketClient.emit('new-message', {
                id: 'system',
                message: '🎉 Congratulations! You now have access to the VIP chat!',
                username: 'System',
                timestamp: new Date().toISOString(),
                messageId: `system-${Date.now()}-${randomUUID()}`,
                chatType: 'vip'
              }, 'vip');
            }
          }
        }
      }
      
      // Clean up
      setTimeout(() => {
        sentMessages.delete(badgeEventId);
      }, 10000);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`Client disconnected (${reason}):`, socket.id);
    
    // Clean up stored data
    if (userAddresses[socket.id]) {
      delete userAddresses[socket.id];
    }
    
    if (usernames[socket.id]) {
      delete usernames[socket.id];
    }
  });
});

// Add a basic route for health check
app.get('/', (req, res) => {
  res.send('Socket.IO server is running');
});

// Start the server
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});