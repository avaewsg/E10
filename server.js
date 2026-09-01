const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// پایگاه داده موقت در حافظه (برای پایداری دائمی روی سرور ابری می‌توان به MongoDB متصل کرد)
const db = {
    users: [],    // { username, password, name, avatar, isVerified, lastLogin }
    chats: [],    // { id, type: 'pv'|'group'|'channel', name, members: [], admin }
    messages: {}  // chatId: [{ sender, text, file, type, time }]
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
                avatar: data.avatar || 'https://via.placeholder.com/150',
                isVerified: data.username === 'admin_e10', // تیک آبی پیشفرض برای ادمین کل
                lastLogin: Date.now()
            };
            db.users.push(newUser);
            socket.emit('auth_success', newUser);
        }
    });

    // ورود کاربر با چک کردن انقضای ۲ روزه رمز عبور
    socket.on('login', (data) => {
        const user = db.users.find(u => u.username === data.username && u.password === data.password);
        if (!user) {
            socket.emit('auth_error', 'نام کاربری یا رمز عبور اشتباه است.');
            return;
        }

        const twoDays = 2 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        
        // اگر بیشتر از ۲ روز گذشته باشد، اجبار به ورود مجدد رمز
        if (now - user.lastLogin > twoDays) {
            socket.emit('password_expired', 'اعتبار نشست ۲ روزه شما به پایان رسیده است. لطفاً رمز عبور را وارد کنید.');
        } else {
            user.lastLogin = now; // تمدید نشست
            socket.emit('auth_success', user);
        }
    });

    // جستجوی آیدی کاربران
    socket.on('search_user', (query) => {
        const results = db.users
            .filter(u => u.username.includes(query))
            .map(u => ({ username: u.username, name: u.name, avatar: u.avatar, isVerified: u.isVerified }));
        socket.emit('search_results', results);
    });

    // ساخت گروه یا کانال
    socket.on('create_room', (data) => {
        const roomId = 'room_' + Date.now();
        const newRoom = {
            id: roomId,
            type: data.type, // 'group' یا 'channel'
            name: data.name,
            admin: data.admin,
            members: [data.admin]
        };
        db.chats.push(newRoom);
        db.messages[roomId] = [];
        io.emit('room_created', newRoom);
    });

    // ارسال پیام (متن، عکس، ویس، فایل)
    socket.on('send_message', (data) => {
        const { chatId, sender, content, type } = data;
        if (!db.messages[chatId]) db.messages[chatId] = [];
        
        const msg = {
            sender,
            content,
            type, // 'text', 'image', 'audio', 'file'
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
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
