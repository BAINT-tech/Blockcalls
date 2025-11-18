require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { AccessToken } = require('livekit-server-sdk');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory room storage
const rooms = new Map();

// Helper: Generate LiveKit token
function generateToken(roomName, participantName, metadata = {}) {
  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    {
      identity: participantName,
      name: metadata.displayName || participantName.substring(0, 8),
      metadata: JSON.stringify(metadata)
    }
  );

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true
  });

  return at.toJwt();
}

// Helper: Create room ID
function generateRoomId() {
  return Math.random().toString(36).substring(2, 12).toUpperCase();
}

// Helper: Create P2P room name
function createP2PRoomName(wallet1, wallet2) {
  const sorted = [wallet1.toLowerCase(), wallet2.toLowerCase()].sort();
  return `call-${sorted[0].substring(0, 8)}-${sorted[1].substring(0, 8)}`;
}

// Health check
app.get('/', (req, res) => {
  res.json({
    status: '✅ BlockCall LiveKit Server Running',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    activeRooms: rooms.size,
    livekitConnected: !!(process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET)
  });
});

// Create group meeting
app.post('/api/create-room', (req, res) => {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address required' });
    }

    // Generate room ID
    const roomId = generateRoomId();
    
    // Create room
    const room = {
      id: roomId,
      host: walletAddress,
      participants: [walletAddress],
      created: Date.now()
    };
    
    rooms.set(roomId, room);

    // Generate token
    const token = generateToken(`meeting-${roomId}`, walletAddress, {
      walletAddress,
      isHost: true,
      callType: 'group'
    });

    console.log('✅ Room created:', roomId, 'by', walletAddress);

    res.json({
      success: true,
      roomId,
      token,
      livekitUrl: process.env.LIVEKIT_URL
    });

  } catch (error) {
    console.error('❌ Create room error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Join group meeting
app.post('/api/join-room', (req, res) => {
  try {
    const { roomId, walletAddress } = req.body;

    if (!roomId || !walletAddress) {
      return res.status(400).json({ error: 'Room ID and wallet address required' });
    }

    // Get room
    const room = rooms.get(roomId);
    
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Add participant
    if (!room.participants.includes(walletAddress)) {
      room.participants.push(walletAddress);
    }

    // Generate token
    const token = generateToken(`meeting-${roomId}`, walletAddress, {
      walletAddress,
      isHost: false,
      callType: 'group'
    });

    console.log('👥 User joined room:', roomId, walletAddress);

    res.json({
      success: true,
      token,
      livekitUrl: process.env.LIVEKIT_URL,
      room: {
        id: room.id,
        host: room.host,
        participantCount: room.participants.length
      }
    });

  } catch (error) {
    console.error('❌ Join room error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start wallet-to-wallet call
app.post('/api/start-call', (req, res) => {
  try {
    const { callerWallet, calleeWallet } = req.body;

    if (!callerWallet || !calleeWallet) {
      return res.status(400).json({ error: 'Both wallet addresses required' });
    }

    // Create room name
    const roomName = createP2PRoomName(callerWallet, calleeWallet);

    // Generate token for caller
    const token = generateToken(roomName, callerWallet, {
      walletAddress: callerWallet,
      isCaller: true,
      callType: 'p2p'
    });

    console.log('📞 Call started:', callerWallet, '→', calleeWallet);

    res.json({
      success: true,
      token,
      roomName,
      livekitUrl: process.env.LIVEKIT_URL
    });

  } catch (error) {
    console.error('❌ Start call error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Answer wallet-to-wallet call
app.post('/api/answer-call', (req, res) => {
  try {
    const { callerWallet, calleeWallet } = req.body;

    if (!callerWallet || !calleeWallet) {
      return res.status(400).json({ error: 'Both wallet addresses required' });
    }

    // Create room name (same as caller)
    const roomName = createP2PRoomName(callerWallet, calleeWallet);

    // Generate token for callee
    const token = generateToken(roomName, calleeWallet, {
      walletAddress: calleeWallet,
      isCaller: false,
      callType: 'p2p'
    });

    console.log('✅ Call answered:', calleeWallet, '←', callerWallet);

    res.json({
      success: true,
      token,
      roomName,
      livekitUrl: process.env.LIVEKIT_URL
    });

  } catch (error) {
    console.error('❌ Answer call error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Leave room
app.post('/api/leave-room', (req, res) => {
  try {
    const { roomId, walletAddress } = req.body;

    const room = rooms.get(roomId);
    
    if (room) {
      room.participants = room.participants.filter(p => p !== walletAddress);
      
      if (room.participants.length === 0) {
        rooms.delete(roomId);
        console.log('🗑️ Room deleted:', roomId);
      }
    }

    console.log('👋 User left room:', roomId, walletAddress);

    res.json({ success: true });

  } catch (error) {
    console.error('❌ Leave room error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get room info
app.get('/api/room/:roomId', (req, res) => {
  try {
    const { roomId } = req.params;
    const room = rooms.get(roomId);

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    res.json({
      success: true,
      room: {
        id: room.id,
        host: room.host,
        participantCount: room.participants.length,
        created: room.created
      }
    });

  } catch (error) {
    console.error('❌ Get room error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   🚀 BlockCall LiveKit Server v2.0           ║
║   ✅ Running on port ${PORT.toString().padEnd(24)}║
║   🌐 LiveKit: ${process.env.LIVEKIT_URL ? '✅ Connected' : '❌ Not configured'.padEnd(24)}║
╚══════════════════════════════════════════════╝
  `);
});

module.exports = app;
