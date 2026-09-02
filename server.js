const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const db = {
    users: [
        { username: 'kia12', password: 'kia12', name: 'مالک اصلی', isVerified: true, isOwner: true, removeBlueTick: false, customBadge: '' },
        { username: 'kiya12', password: 'kiya12', name: 'مالک اصلی', isVerified: true, isOwner: true, removeBlueTick: false, customBadge: '' }
    ],
    groupState: {
        isLocked: false
    },
    messages: []
};

let globalCustomEmojis = [];
let globalCustomStickers = [];

io.on('connection', (socket) => {
    
    socket.emit('sync_custom_emojis', globalCustomEmojis);
    socket.emit('sync_custom_stickers', globalCustomStickers);

    socket.on('add_custom_emoji', (newEmoji) => {
        if (!globalCustomEmojis.find(e => e.tag === newEmoji.tag)) {
            globalCustomEmojis.push(newEmoji);
        }
        io.emit('sync_custom_emojis', globalCustomEmojis);
    });

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
            const isOwnerAcc = (data.username === 'kia12' || data.username === 'kiya12');
            const newUser = {
                username: data.username,
                password: data.password,
                name: data.name,
                isVerified: isOwnerAcc,
                isOwner: isOwnerAcc,
                removeBlueTick: false,
                customBadge: ''
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

    socket.on('update_owner_settings', (data) => {
        const user = db.users.find(u => u.username === data.username);
        if (user && user.isOwner) {
            if (data.newName !== undefined) user.name = data.newName;
            if (data.removeBlueTick !== undefined) user.removeBlueTick = data.removeBlueTick;
            if (data.customBadge !== undefined) user.customBadge = data.customBadge;
            if (data.isLocked !== undefined) db.groupState.isLocked = data.isLocked;
            
            io.emit('settings_updated', { updatedUser: user, isLocked: db.groupState.isLocked });
        }
    });

    socket.on('typing_start', ({ username }) => {
        socket.broadcast.emit('display_typing', { username });
    });

    socket.on('typing_stop', ({ username }) => {
        socket.broadcast.emit('hide_typing', { username });
    });

    socket.on('send_message', (data) => {
        const { sender, content, type, replyTo } = data;
        const senderUser = db.users.find(u => u.username === sender);

        if (db.groupState.isLocked && senderUser && !senderUser.isOwner) {
            socket.emit('auth_error', 'گپ اصلی قفل است.');
            return;
        }

        const msg = {
            id: 'msg_' + Date.now() + Math.random(),
            sender,
            senderName: senderUser ? senderUser.name : sender,
            customBadge: senderUser ? senderUser.customBadge : '',
            removeBlueTick: senderUser ? senderUser.removeBlueTick : false,
            isOwner: senderUser ? senderUser.isOwner : false,
            isVerified: senderUser ? senderUser.isVerified : false,
            content,
            type: type || 'text',
            replyTo: replyTo || null,
            reactions: {},
            seenBy: [sender],
            time: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
        };
        
        db.messages.push(msg);
        io.emit('new_message', { msg });
    });

    socket.on('mark_messages_seen', ({ username }) => {
        let updated = false;
        db.messages.forEach(msg => {
            if (!msg.seenBy) msg.seenBy = [];
            if (!msg.seenBy.includes(username)) {
                msg.seenBy.push(username);
                updated = true;
            }
        });
        if (updated) {
            io.emit('load_history', { messages: db.messages, isLocked: db.groupState.isLocked });
        }
    });

    socket.on('toggle_reaction', ({ msgId, emoji, username }) => {
        const msg = db.messages.find(m => m.id === msgId);
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

            io.emit('message_updated', { msg });
        }
    });

    socket.on('delete_message', ({ msgId, username }) => {
        const index = db.messages.findIndex(m => m.id === msgId);
        if (index !== -1) {
            const user = db.users.find(u => u.username === username);
            if (db.messages[index].sender === username || (user && user.isOwner)) {
                db.messages.splice(index, 1);
                io.emit('message_deleted', { msgId });
            }
        }
    });

    socket.on('join_main_room', () => {
        socket.emit('load_history', { messages: db.messages, isLocked: db.groupState.isLocked });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`E10 Server running on port ${PORT}`));
