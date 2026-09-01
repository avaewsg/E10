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
    chats: [],    
    messages: {}  
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

        const twoDays = 2 * 24 * 60 * 60 * 1000;
        if (Date.now() - user.lastLogin > twoDays) {
            socket.emit('password_expired', 'اعتبار نشست ۲ روزه شما منقضی شد. لطفاً مجدداً رمز ورود را وارد کنید.');
        } else {
            user.lastLogin = Date.now();
            socket.emit('auth_success', user);
        }
    });

    socket.on('search', (query) => {
        const users = db.users
            .filter(u => u.username.includes(query) || u.name.includes(query))
            .map(u => ({ username: u.username, name: u.name, avatar: u.avatar, isVerified: u.isVerified, type: 'user' }));
        
        const chats = db.chats
            .filter(c => c.name.includes(query))
            .map(c => ({ id: c.id, name: c.name, type: c.type, isVerified: c.isVerified }));

        socket.emit('search_results', [...users, ...chats]);
    });

    socket.on('toggle_verified', (data) => {
        const { targetUsername, adminUsername } = data;
        const admin = db.users.find(u => u.username === adminUsername);
        
        if (admin && admin.isOwner) {
            const target = db.users.find(u => u.username === targetUsername);
            if (target) {
                target.isVerified = !target.isVerified;
                io.emit('update_user_status', { username: target.username, isVerified: target.isVerified });
                socket.emit('notification', `وضعیت تیک آبی برای @${target.username} تغییر کرد.`);
            } else {
                const targetChat = db.chats.find(c => c.id === targetUsername);
                if (targetChat) {
                    targetChat.isVerified = !targetChat.isVerified;
                    io.emit('notification', `وضعیت تیک آبی برای گروه/کانال تغییر کرد.`);
                }
            }
        } else {
            socket.emit('auth_error', 'شما دسترسی مالک را ندارید!');
        }
    });

    socket.on('create_room', (data) => {
        const roomId = 'room_' + Date.now();
        const newRoom = {
            id: roomId,
            type: data.type,
            name: data.name,
            admin: data.admin,
            isVerified: false,
            members: [data.admin]
        };
        db.chats.push(newRoom);
        db.messages[roomId] = [];
        io.emit('room_created', newRoom);
    });

    // رفع مشکل ارسال پیام در پی‌وی و اتاق‌ها
    socket.on('send_message', (data) => {
        const { chatId, sender, content, type } = data;
        if (!db.messages[chatId]) db.messages[chatId] = [];
        
        const msg = {
            sender,
            content,
            type,
            time: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
        };
        db.messages[chatId].push(msg);

        // اگر پی‌وی بود، مطمئن شویم در لیست چت‌های دوجانبه ثبت شده است
        if (chatId.startsWith('pv_')) {
            let chatExists = db.chats.find(c => c.id === chatId);
            const parts = chatId.replace('pv_', '').split('_');
            const user1 = db.users.find(u => u.username === parts[0]);
            const user2 = db.users.find(u => u.username === parts[1]);

            if (!chatExists) {
                if (user1 && user2) {
                    const newPvChat = {
                        id: chatId,
                        type: 'pv',
                        name: `${user1.name} & ${user2.name}`,
                        members: [parts[0], parts[1]]
                    };
                    db.chats.push(newPvChat);
                }
            } else {
                if (!chatExists.members) chatExists.members = [parts[0], parts[1]];
            }

            // عضو کردن اجباری فرستنده و گیرنده در روم سکتور برای دریافت آنلاین پیام
            io.in(chatId).socketsJoin ? socket.join(chatId) : null;
        }

        // ارسال پیام به همه افراد حاضر در این چت‌روم
        io.to(chatId).emit('new_message', { chatId, msg });

        // اطلاع‌رسانی به کاربر مقابل جهت به‌روزرسانی لیست چت‌ها
        if (chatId.startsWith('pv_')) {
            const parts = chatId.replace('pv_', '').split('_');
            const receiverUsername = parts[0] === sender ? parts[1] : parts[0];
            const senderUser = db.users.find(u => u.username === sender);
            
            if (senderUser) {
                io.emit('notify_new_chat', {
                    chatId: chatId,
                    sender: senderUser,
                    receiver: receiverUsername,
                    lastMessage: msg
                });
            }
        }
    });

    socket.on('join_room', (chatId) => {
        socket.join(chatId);
        socket.emit('load_history', db.messages[chatId] || []);
    });

    socket.on('get_user_chats', (username) => {
        const userChats = db.chats.filter(c => (c.members && c.members.includes(username)) || c.type === 'group' || c.type === 'channel');
        socket.emit('user_chats_loaded', userChats);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`E10 Server running on port ${PORT}`));
