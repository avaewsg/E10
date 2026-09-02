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

// آرایه‌های گلوبال در حافظه سرور برای ذخیره ایموجی و استیکر کاستوم
let globalCustomEmojis = [];
let globalCustomStickers = [];

io.on('connection', (socket) => {
    
    // ارسال آخرین ایموجی و استیکرها به کاربر جدید به محض اتصال
    socket.emit('sync_custom_emojis', globalCustomEmojis);
    socket.emit('sync_custom_stickers', globalCustomStickers);

    // افزودن ایموجی کاستوم جدید
    socket.on('add_custom_emoji', (newEmoji) => {
        if (!globalCustomEmojis.find(e => e.tag === newEmoji.tag)) {
            globalCustomEmojis.push(newEmoji);
        }
        io.emit('sync_custom_emojis', globalCustomEmojis);
    });

    // افزودن استیکر کاستوم جدید
    socket.on('add_custom_sticker', (stickerBase64) => {
        if (!globalCustomStickers.includes(stickerBase64)) {
            globalCustomStickers.push(stickerBase64);
        }
        io.emit('sync_custom_stickers', globalCustomStickers);
    });

    socket.on('register', (data) => {
        const exists = db.users.find(u => u.username === data.username);
        if (exists) {
            socket.emit('auth_error', 'این نام کاربری قبلاً ثبت شده است.');
        } else {
            const newUser = {
                username: data.username,
                password: data.password,
                name: data.name,
                avatar: '',
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

    socket.on('typing_start', ({ chatId, username }) => {
        socket.to(chatId).emit('display_typing', { username });
    });

    socket.on('typing_stop', ({ chatId, username }) => {
        socket.to(chatId).emit('hide_typing', { username });
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
            type: type || 'text',
            replyTo: replyTo || null,
            reactions: {},
            seenBy: [sender],
            isVerified: isOwnerOrVerified,
            time: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
        };
        
        db.messages[chatId].push(msg);
        io.to(chatId).emit('new_message', { chatId, msg });
    });

    socket.on('mark_messages_seen', ({ chatId, username }) => {
        const messages = db.messages[chatId];
        if (messages) {
            let updated = false;
            messages.forEach(msg => {
                if (!msg.seenBy) msg.seenBy = [];
                if (!msg.seenBy.includes(username)) {
                    msg.seenBy.push(username);
                    updated = true;
                }
            });
            if (updated) {
                io.to(chatId).emit('load_history', messages);
            }
        }
    });

    socket.on('toggle_reaction', ({ chatId, msgId, emoji, username }) => {
        const messages = db.messages[chatId];
        if (messages) {
            const msg = messages.find(m => m.id === msgId);
            if (msg) {
                if (!msg.reactions) msg.reactions = {};

                let alreadyHasThisEmoji = false;
                if (msg.reactions[emoji] && msg.reactions[emoji].includes(username)) {
                    alreadyHasThisEmoji = true;
                }

                for (const key of Object.keys(msg.reactions)) {
                    msg.reactions[key] = msg.reactions[key].filter(u => u !== username);
                    if (msg.reactions[key].length === 0) {
                        delete msg.reactions[key];
                    }
                }

                if (!alreadyHasThisEmoji) {
                    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
                    msg.reactions[emoji].push(username);
                }

                io.to(chatId).emit('message_updated', { chatId, msg });
            }
        }
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
