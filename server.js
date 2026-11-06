const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const port = 8080;

const broadcasters = {}; // roomId -> socket.id milik broadcaster

// Membaca sertifikat HTTPS
const options = {
    key: fs.readFileSync(path.join(__dirname, 'ssl', 'key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'ssl', 'cert.pem'))
};

// Menyediakan file HTML dan JavaScript dari folder public
app.use(express.static(path.join(__dirname, 'public')));

// Membuat server HTTPS dan Socket.IO
const server = https.createServer(options, app);
const io = new Server(server);

// Logika signaling
io.on('connection', (socket) => {
    console.log('User terhubung:', socket.id);

    
    // Meneruskan subtitle broadcaster kepada viewer
    socket.on('caption', (payload) => {
        if (
            !payload ||
            typeof payload.roomId !== 'string' ||
            typeof payload.text !== 'string'
        ) {
            return;
        }

        const roomId = payload.roomId.trim();
        const text = payload.text.trim();

        if (
            !roomId ||
            !text ||
            text.length > 1000 ||
            !socket.rooms.has(roomId)
        ) {
            return;
        }

        io.to(roomId).emit('caption', {
            text,
            isFinal: Boolean(payload.isFinal)
        });
    });


        // Broadcaster bergabung ke room
    socket.on('join-room', (roomId) => {
        socket.join(roomId);
        broadcasters[roomId] = socket.id;
        console.log(`Broadcaster ${socket.id} bergabung ke room ${roomId}`);
    });

    // Viewer bergabung ke room
    socket.on('join-as-viewer', (payload) => {
        // Mendukung format lama (string) dan baru ({ roomId, name })
        const roomId = typeof payload === 'string' ? payload : payload?.roomId;
        if (typeof roomId !== 'string' || !roomId.trim()) return;

        const rawName = typeof payload === 'object' ? payload?.name : '';
        socket.data.name =
            (typeof rawName === 'string' ? rawName : '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 24) || 'Viewer';

        socket.join(roomId);
        console.log(`Viewer "${socket.data.name}" (${socket.id}) bergabung ke room ${roomId}`);

        // Beri tahu viewer siapa broadcaster-nya
        socket.emit('broadcaster-info', {
            broadcasterId: broadcasters[roomId] || null
        });

        // Kirim daftar viewer lain (tanpa broadcaster) ke viewer baru
        const peers = [];
        for (const id of io.sockets.adapter.rooms.get(roomId) || []) {
            if (id === socket.id || id === broadcasters[roomId]) continue;
            const s = io.sockets.sockets.get(id);
            peers.push({ viewerId: id, name: s?.data?.name || 'Viewer' });
        }
        socket.emit('room-peers', { peers });

        socket.to(roomId).emit('viewer-joined', {
            viewerId: socket.id,
            name: socket.data.name
        });
    });

    // Meneruskan offer dari broadcaster
    socket.on('offer', (payload) => {
        io.to(payload.target).emit('offer', {
            sdp: payload.sdp,
            broadcasterId: socket.id
        });
    });

    // Meneruskan answer dari viewer
    socket.on('answer', (payload) => {
        io.to(payload.target).emit('answer', {
            sdp: payload.sdp,
            viewerId: socket.id
        });
    });

    // Meneruskan ICE candidate
        socket.on('ice-candidate', (payload) => {
        io.to(payload.target).emit('ice-candidate', {
            candidate: payload.candidate,
            senderId: socket.id
        });
    });

        // ===== Kamera viewer -> broadcaster =====
    socket.on('viewer-offer', (payload) => {
        if (!payload || typeof payload.roomId !== 'string') return;

        const broadcasterId = broadcasters[payload.roomId];
        if (!broadcasterId || !socket.rooms.has(payload.roomId)) return;

        io.to(broadcasterId).emit('viewer-offer', {
            sdp: payload.sdp,
            viewerId: socket.id,
            name: socket.data.name || 'Viewer'
        });
    });

    socket.on('viewer-answer', (payload) => {
        io.to(payload.target).emit('viewer-answer', {
            sdp: payload.sdp,
            broadcasterId: socket.id
        });
    });

    socket.on('viewer-ice', (payload) => {
        io.to(payload.target).emit('viewer-ice', {
            candidate: payload.candidate,
            senderId: socket.id
        });
    });

    socket.on('viewer-stopped', (payload) => {
        const broadcasterId = broadcasters[payload?.roomId];
        if (broadcasterId) {
            io.to(broadcasterId).emit('viewer-left', { viewerId: socket.id });
        }
    });

    // ===== Signaling antar-viewer (mesh) =====
    socket.on('peer-offer', (p) => {
        if (!p?.target) return;
        io.to(p.target).emit('peer-offer', { sdp: p.sdp, senderId: socket.id });
    });

    socket.on('peer-answer', (p) => {
        if (!p?.target) return;
        io.to(p.target).emit('peer-answer', { sdp: p.sdp, senderId: socket.id });
    });

    socket.on('peer-ice', (p) => {
        if (!p?.target) return;
        io.to(p.target).emit('peer-ice', { candidate: p.candidate, senderId: socket.id });
    });

    // Status kamera/mikrofon (target opsional; kalau kosong -> semua di room)
    socket.on('peer-media', (p) => {
        if (!p || typeof p.roomId !== 'string' || !socket.rooms.has(p.roomId)) return;
        const data = { senderId: socket.id, video: !!p.video, audio: !!p.audio };
        if (typeof p.target === 'string') io.to(p.target).emit('peer-media', data);
        else socket.to(p.roomId).emit('peer-media', data);
    });

    socket.on('disconnecting', () => {
        for (const roomId of socket.rooms) {
            if (roomId === socket.id) continue;

            if (broadcasters[roomId] === socket.id) {
                delete broadcasters[roomId];
            } else if (broadcasters[roomId]) {
                io.to(broadcasters[roomId]).emit('viewer-left', {
                    viewerId: socket.id
                });
                socket.to(roomId).emit('peer-left', { viewerId: socket.id });
            }
        }
    });

    // Ketika browser terputus
    socket.on('disconnect', () => {
        console.log('User terputus:', socket.id);
    });
});


 // Menjalankan server agar dapat diakses melalui jaringan lokal
server.listen(port, '0.0.0.0', () => {
    console.log(`Server HTTPS berjalan di https://localhost:${port}`);
    console.log(`Akses jaringan: https://10.100.30.95:${port}`);
});

