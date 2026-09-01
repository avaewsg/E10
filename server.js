const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// افزایش حد مجاز برای آپلود عکس و فایل
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// پایگاه داده در حافظه
const db = {
    users: [
        { username: 'kia12', password: 'kia12', name: 'مالک اصلی', avatar: '', isVerified: true, isOwner: true, lastLogin: Date.now() }
    ],
    chats: [],    // { id, type: 'group'|'channel', name, admin, members: [] }
    messages: {}  // chatId: [{ sender, content, type, time }]
};

io.on('connection', (socket) => {
    
    // ثبت‌نام کاربر جدید
    socket.on('register', (data) => {
        const exists = db.users.find(u => u.username === data.username);
        if (exists) {
            socket.emit('auth_error', 'این نام کاربری قبلاً ثبت شده است.');
        } else {
            const newUser = {
                username: data.username,
                password: data.password,
                name: data.name,
                avatar: data.avatar || '', // فایل Base64 عکس
                isVerified: false,
                isOwner: data.username === 'kia12',
                lastLogin: Date.now()
            };
            db.users.push(newUser);
            socket.emit('auth_success', newUser);
        }
    });

    // ورود کاربر با کنترل انقضای ۲ روزه
    socket.on('login', (data) => {
        const user = db.users.find(u => u.username === data.username && u.password === data.password);
        if (!user) {
            socket.emit('auth_error', 'نام کاربری یا رمز عبور اشتباه است.');
            return;
        }

        const twoDays = 2 * 24 * 60 * 60 * 1000;
        if (Date.now() - user.lastLogin > twoDays) {
            socket.emit('password_expired', 'اعتبار نشست ۲ روزه شما منقضی شد. لطفاً مجدداً رمز ورود را وارد کنید.');
        } else {
            user.lastLogin = Date.now();
            socket.emit('auth_success', user);
        }
    });

    // جستجوی کاربران یا کانال‌ها
    socket.on('search', (query) => {
        const users = db.users
            .filter(u => u.username.includes(query) || u.name.includes(query))
            .map(u => ({ username: u.username, name: u.name, avatar: u.avatar, isVerified: u.isVerified, type: 'user' }));
        
        const chats = db.chats
            .filter(c => c.name.includes(query))
            .map(c => ({ id: c.id, name: c.name, type: c.type, isVerified: c.isVerified }));

        socket.emit('search_results', [...users, ...chats]);
    });

    // درخواست مالک برای دادن یا گرفتن تیک آبی
    socket.on('toggle_verified', (data) => {
        const { targetUsername, adminUsername } = data;
        const admin = db.users.find(u => u.username === adminUsername);
        
        if (admin && admin.isOwner) {
            const target = db.users.find(u => u.username === targetUsername);
            if (target) {
                target.isVerified = !target.isVerified;
                io.emit('update_user_status', { username: target.username, isVerified: target.isVerified });
                socket.emit('notification', `وضعیت تیک آبی برای @${target.username} تغییر کرد.`);
            }
        } else {
            socket.emit('auth_error', 'شما دسترسی مالک را ندارید!');
        }
    });

    // ساخت گروه یا کانال
    socket.on('create_room', (data) => {
        const roomId = 'room_' + Date.now();
        const newRoom = {
            id: roomId,
            type: data.type, // 'group' یا 'channel'
            name: data.name,
            admin: data.admin,
            isVerified: false,
            members: [data.admin]
        };
        db.chats.push(newRoom);
        db.messages[roomId] = [];
        io.emit('room_created', newRoom);
    });

    // ارسال پیام (متن، عکس، ویس)
    socket.on('send_message', (data) => {
        const { chatId, sender, content, type } = data;
        if (!db.messages[chatId]) db.messages[chatId] = [];
        
        const msg = {
            sender,
            content,
            type, // 'text', 'image', 'audio'
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
