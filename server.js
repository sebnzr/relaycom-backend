const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

// State tracking
const users = {}; // socket.id -> { username, displayName }
const usernameToIds = {}; // username -> socket.id
const rooms = {}; // roomName -> Set(usernames)

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Register user profile
    socket.on('register', ({ username, displayName }) => {
        if (!username) return;
        
        // Clean up older connection if username is re-used
        if (usernameToIds[username]) {
            const oldSocketId = usernameToIds[username];
            io.to(oldSocketId).emit('force-disconnect');
        }

        socket.username = username;
        users[socket.id] = { username, displayName };
        usernameToIds[username] = socket.id;

        // Broadcast updated online user directory
        io.emit('online-users', Object.values(users));
    });

    // WebRTC Signaling Relay & Stealth Tunnel Fallback Router
    socket.on('signal', (data) => {
        if (!socket.username) return;
        
        // Stamp the sender's username onto the incoming payload
        data.sender = socket.username;

        if (data.target) {
            const targetSocketId = usernameToIds[data.target.toLowerCase()];
            if (targetSocketId) {
                // Pass the complete payload unaltered (SDP, candidates, or text messages)
                io.to(targetSocketId).emit('signal', data);
            }
        }
    });

    // Mesh Network: Group Chat Room Management
    socket.on('join-room', (roomName) => {
        if (!socket.username) return;
        
        socket.join(roomName);
        if (!rooms[roomName]) {
            rooms[roomName] = new Set();
        }

        // Get list of existing peers in the room before adding the new user
        const existingPeers = Array.from(rooms[roomName]);
        rooms[roomName].add(socket.username);

        // Notify the new user about existing peers to initiate P2P data channels
        socket.emit('room-peers', { roomName, peers: existingPeers });
        
        // Announce to the room that a new peer joined
        socket.to(roomName).emit('peer-joined-room', { roomName, username: socket.username });
    });

    // Handle Disconnection
    socket.on('disconnect', () => {
        if (socket.username) {
            delete usernameToIds[socket.username];
            delete users[socket.id];
            
            // Remove user from all tracked rooms
            Object.keys(rooms).forEach(roomName => {
                rooms[roomName].delete(socket.username);
                if (rooms[roomName].size === 0) {
                    delete rooms[roomName];
                }
            });

            io.emit('online-users', Object.values(users));
            console.log(`User disconnected: ${socket.username}`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Relaycom Signaling Server running on http://localhost:${PORT}`);
});