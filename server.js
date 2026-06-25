const express = require('express');
const path = require('path');
const app = express();
const server = require('http').createServer(app);

const io = require('socket.io')(server);

app.use(express.static(path.join(__dirname, '/public')));

io.on('connection', function(socket) {
    socket.on('newuser', function(username) {
        io.emit('update', username + ' joined the chat');
    });
    socket.on('exituser', function(username) {
        io.emit('update', username + ' left the chat');
    });
    socket.on('chat', function(message) {
        socket.broadcast.emit('chat', message);
    });
});

server.listen(5000);