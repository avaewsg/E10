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
        { username: 'kia12', password: 'kia12', name: 'مالک اصلی', avatar: '', isVerified: true, isOwner: true },
        { username: 'kiya12', password: 'kiya12', name: 'مالک اصلی', avatar: '', isVerified: true, isOwner: true }
    ],
    chats: [
        { id: 'main_group', type: 'group', name: 'گروه اصلی مالک', admin: 'kia12', isVerified: true, isLocked: false }
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
                avatar: '', // بدون پروفایل
                isVerified: false,
                isOwner: data.username === 'kia12' || data.username === 'kiya12'
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
        socket.emit('auth_success', user);
    });

    socket.on('update_profile', (data) => {
        const user = db.users.find(u => u.username === data.username);
        if (user) {
            if (data.newName) user.name = data.newName;
            // عکس پروفایل غیرفعال شد
            socket.emit('profile_updated', user);
        }
    });

    socket.on('get_user_chats', () => {
        socket.emit('user_chats_loaded', db.chats);
    });

    socket.on('create_room', (data) => {
        const roomId = 'room_' + Date.now();
        const creator = db.users.find(u => u.username === data.admin);
        const isOwnerOrVerified = creator ? (creator.isOwner || creator.isVerified) : false;

        const newRoom = {
            id: roomId,
            type: 'group',
            name: data.name,
            admin: data.admin,
            isVerified: isOwnerOrVerified,
            isLocked: false
        };
        db.chats.push(newRoom);
        db.messages[roomId] = [];
        
        io.emit('user_chats_loaded', db.chats);
    });

    socket.on('update_group', (data) => {
        const chat = db.chats.find(c => c.id === data.chatId);
        if (chat) {
            if (data.name !== undefined) chat.name = data.name;
            if (data.isLocked !== undefined) chat.isLocked = data.isLocked;

            io.emit('group_updated', chat);
            io.emit('user_chats_loaded', db.chats);
        }
    });

    socket.on('send_message', (data) => {
        const { chatId, sender, content, type, replyTo } = data;
        const chat = db.chats.find(c => c.id === chatId);
        const senderUser = db.users.find(u => u.username === sender);

        if (chat && chat.isLocked && senderUser && !senderUser.isOwner) {
            socket.emit('auth_error', 'گروه توسط مالک قفل شده است.');
            return;
        }

        if (!db.messages[chatId]) db.messages[chatId] = [];
        
        const isOwnerOrVerified = senderUser ? (senderUser.isOwner || senderUser.isVerified) : false;

        const msg = {
            id: 'msg_' + Date.now() + Math.random(),
            sender,
            senderName: senderUser ? senderUser.name : sender,
            content,
            type: 'text', // فقط متنی
            replyTo: replyTo || null,
            isVerified: isOwnerOrVerified,
            time: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
        };
        
        db.messages[chatId].push(msg);
        io.to(chatId).emit('new_message', { chatId, msg });
    });

    socket.on('delete_message', ({ chatId, msgId, username }) => {
        const messages = db.messages[chatId];
        if (messages) {
            const index = messages.findIndex(m => m.id === msgId);
            if (index !== -1) {
                const user = db.users.find(u => u.username === username);
                if (messages[index].sender === username || (user && user.isOwner)) {
                    messages.splice(index, 1);
                    io.to(chatId).emit('message_deleted', { chatId, msgId });
                }
            }
        }
    });

    socket.on('join_room', (chatId) => {
        socket.join(chatId);
        socket.emit('load_history', db.messages[chatId] || []);
        const chat = db.chats.find(c => c.id === chatId);
        if (chat) {
            socket.emit('group_updated', chat);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`E10 Server running on port ${PORT}`));
