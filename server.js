const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const db = {
    users: [
        { username: 'kia12', password: 'kia12', name: 'مالک اصلی', avatar: '', isVerified: true, isOwner: true, lastLogin: Date.now() },
        { username: 'kiya12', password: 'kiya12', name: 'مالک اصلی', avatar: '', isVerified: true, isOwner: true, lastLogin: Date.now() }
    ],
    chats: [
        { id: 'main_group', type: 'group', name: 'گروه اصلی مالک', admin: 'kia12', isVerified: true }
    ],    
    messages: {
        'main_group': []
    }  
};

io.on('connection', (socket) => {
    
    socket.on('register', (data) => {
        const exists = db.users.find(u => u.username === data.username);
        if (exists) {
            socket.emit('auth_error', 'این نام کاربری قبلاً ثبت شده است.');
        } else {
            const newUser = {
                username: data.username,
                password: data.password,
                name: data.name,
                avatar: data.avatar || '',
                isVerified: false,
                isOwner: data.username === 'kia12' || data.username === 'kiya12',
                lastLogin: Date.now()
            };
            db.users.push(newUser);
            socket.emit('auth_success', newUser);
        }
    });

    socket.on('login', (data) => {
        const user = db.users.find(u => u.username === data.username && u.password === data.password);
        if (!user) {
            socket.emit('auth_error', 'نام کاربری یا رمز عبور اشتباه است.');
            return;
        }
        user.lastLogin = Date.now();
        socket.emit('auth_success', user);
    });

    socket.on('get_user_chats', (username) => {
        socket.emit('user_chats_loaded', db.chats);
    });

    // ساخت گروه با بررسی تیک آبی مالک
    socket.on('create_room', (data) => {
        const roomId = 'room_' + Date.now();
        const creator = db.users.find(u => u.username === data.admin);
        const isOwnerOrVerified = creator ? (creator.isOwner || creator.isVerified) : false;

        const newRoom = {
            id: roomId,
            type: data.type,
            name: data.name,
            admin: data.admin,
            isVerified: isOwnerOrVerified // اگر مالک بسازد تیک آبی می‌گیرد
        };
        db.chats.push(newRoom);
        db.messages[roomId] = [];
        
        io.emit('room_created', newRoom);
    });

    socket.on('send_message', (data) => {
        const { chatId, sender, content, type } = data;
        if (!db.messages[chatId]) db.messages[chatId] = [];
        
        const senderUser = db.users.find(u => u.username === sender);
        const isOwnerOrVerified = senderUser ? (senderUser.isOwner || senderUser.isVerified) : false;

        const msg = {
            sender,
            senderName: senderUser ? senderUser.name : sender,
            content,
            type,
            isVerified: isOwnerOrVerified,
            time: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
        };
        
        db.messages[chatId].push(msg);
        io.to(chatId).emit('new_message', { chatId, msg });
    });

    socket.on('join_room', (chatId) => {
        socket.join(chatId);
        socket.emit('load_history', db.messages[chatId] || []);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`E10 Server running on port ${PORT}`));
