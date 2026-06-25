(function(){
    const app = document.querySelector('.app');
    const socket = (typeof window.io === 'function')
        ? window.io()
        : {
            emit: function() {},
            on: function() {}
        };

    let uname;
    function joinChat() {
        let username = app.querySelector('.join-screen #username').value.trim();
        if(username.length == 0){
            return;
        }
        socket.emit('newuser', username);
        uname = username;
        app.querySelector('.join-screen').classList.remove('active');
        app.querySelector('.chat-screen').classList.add('active');
    }

    app.querySelector('.join-screen #join-user').addEventListener('click', joinChat);
    app.querySelector('.join-screen #username').addEventListener('keydown', function(e) {
        if(e.key === 'Enter') {
            joinChat();
        }
    });

    function sendChatMessage() {
        let message = app.querySelector('.chat-screen #message-input').value.trim();
        if(message.length == 0){
            return;
        }
        renderMessage('my', {
            username: uname,
            text: message
        });
        socket.emit('chat', {
            username: uname,
            text: message
        });
        app.querySelector('.chat-screen #message-input').value = '';
    }

    app.querySelector('.chat-screen #send-message').addEventListener('click', sendChatMessage);
    app.querySelector('.chat-screen #message-input').addEventListener('keydown', function(e) {
        if(e.key === 'Enter') {
            sendChatMessage();
        }
    });

    app.querySelector('.chat-screen #close-chat').addEventListener('click', function() {
        socket.emit('exituser', uname);
        window.location.href = window.location.href;
    });
    socket.on('update', function(update){
        renderMessage('update', update);
    });

    socket.on('chat', function(message) {
        renderMessage('other', message);
    });

    function renderMessage(type, message) {
        let messageContainer = app.querySelector('.chat-screen .messages');
        if(type == 'my'){
            let el = document.createElement('div');
            el.setAttribute('class', 'message my-message');
            el.innerHTML = `
                <div>
                    <div class="name">You</div>
                    <div class="text">${message.text}</div>
                </div>
            `;
            messageContainer.appendChild(el);
        } else if(type == 'other') {
            let el = document.createElement('div');
            el.setAttribute('class', 'message other-message');
            el.innerHTML = `
                <div>
                    <div class="name">${message.username}</div>
                    <div class="text">${message.text}</div>
                </div>
            `;
            messageContainer.appendChild(el);

        }else if(type == 'update') {
            let el = document.createElement('div');
            el.setAttribute('class', 'update');
            el.innerText = message;
            messageContainer.appendChild(el);
        }
        //scroll chat to end
        messageContainer.scrollTop = messageContainer.scrollHeight - messageContainer.clientHeight;
    }
})();