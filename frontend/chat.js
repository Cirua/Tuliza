// Tuliza chat (student ↔ mentor ↔ psychiatrist) using WebSocket
// Server: ws://localhost:3000/server

(function () {
  const WS_URL = 'ws://localhost:3000/server';

  // Elements
  const chatRoot = document.getElementById('tuliza-chat');
  if (!chatRoot) return;

  const header = chatRoot.querySelector('#chat-header');
  const messagesEl = chatRoot.querySelector('#chat-messages');
  const inputForm = chatRoot.querySelector('#chat-input-form');
  const input = chatRoot.querySelector('#chat-input');
  const clearBtn = chatRoot.querySelector('#chat-clear');

  const roleSelect = chatRoot.querySelector('#chat-role');
  const nameInput = chatRoot.querySelector('#chat-username');
  const targetStudentInput = chatRoot.querySelector('#chat-targetStudent');

  const joinModal = chatRoot.querySelector('#chat-join-modal');
  const joinForm = chatRoot.querySelector('#chat-join-form');

  // State
  let ws;
  let myRole = null;
  let myUserId = null;
  let myNameForUI = '';

  // Helpers
  function roleLabel(role) {
    if (role === 'student') return 'Student';
    if (role === 'mentor') return 'Mentor';
    if (role === 'psychiatrist') return 'Psychiatrist';
    return role || '';
  }

  function addMessage({ sender, text, timestamp, fromRole }) {
    const type = sender === myNameForUI ? 'user' : 'counselor';

    const safeSender = String(sender ?? 'Unknown');
    const safeText = String(text ?? '');
    const safeTimestamp = String(timestamp ?? '');

    const wrap = document.createElement('div');
    wrap.className = `msg ${type}`;

    // Match existing CSS in frontend/styles.css
    // - Counselor bubble: align-left, background cream
    // - User bubble: align-right, background sage
    const senderLine = document.createElement('div');
    senderLine.style.fontWeight = '600';
    senderLine.style.marginBottom = '6px';
    senderLine.textContent = `${type === 'user' ? 'You' : safeSender}${fromRole ? ` (${roleLabel(fromRole)})` : ''}`;

    const textLine = document.createElement('div');
    textLine.style.whiteSpace = 'pre-wrap';
    textLine.textContent = safeText;

    wrap.appendChild(senderLine);
    wrap.appendChild(textLine);

    if (safeTimestamp) {
      const timestampLine = document.createElement('div');
      timestampLine.style.opacity = '.65';
      timestampLine.style.fontSize = '12px';
      timestampLine.style.marginTop = '6px';
      timestampLine.style.textAlign = 'right';
      timestampLine.textContent = safeTimestamp;
      wrap.appendChild(timestampLine);
    }

    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function connect() {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      // Join happens after user submits the join form.
    };

    ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (_) {
        return;
      }

      // server sends: {sender, text, timestamp, fromRole, toRole}
      addMessage(data);
    };

    ws.onclose = () => {
      // Keep UI simple; just log.
      // If needed, we can show a retry message.
      console.warn('WebSocket closed');
    };
  }

  function joinConversation() {
    const username = nameInput.value.trim();
    const role = roleSelect.value;
    const targetStudent = (targetStudentInput?.value || '').trim();

    if (!username || !role) return;

    myUserId = username; // server uses userId as dashboard id
    myRole = role;
    myNameForUI = username;

    // Update UI header
    header.textContent = `${username} (${roleLabel(role)})`;

    // Join to the server
    ws.send(
      JSON.stringify({
        type: 'join',
        userId: myUserId,
        role: myRole,
        // targetStudent is only needed when sending replies; server join doesn't need it.
      })
    );

    // For mentor/psychiatrist, show that target student is required for replies
    if ((myRole === 'mentor' || myRole === 'psychiatrist') && !targetStudent) {
      // Not blocking; messages will be ignored server-side until targetStudent is provided.
    }

    joinModal.style.display = 'none';
  }

  function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const timestamp = new Date().toLocaleString('en-US', {
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
    });

    if (myRole === 'student') {
      // Student -> mentor + psychiatrist (server delivers to all users of those roles)
      ws.send(
        JSON.stringify({
          fromRole: 'student',
          toRole: 'mentor',
          sender: myNameForUI,
          text,
          timestamp,
          // toUserId omitted intentionally
        })
      );

      ws.send(
        JSON.stringify({
          fromRole: 'student',
          toRole: 'psychiatrist',
          sender: myNameForUI,
          text,
          timestamp,
        })
      );
    } else {
      // Mentor/Psychiatrist -> a specific student
      const targetStudent = (targetStudentInput?.value || '').trim();
      if (!targetStudent) return;

      ws.send(
        JSON.stringify({
          fromRole: myRole,
          toRole: 'student',
          toUserId: targetStudent,
          sender: myNameForUI,
          text,
          timestamp,
        })
      );
    }

    addMessage({
      sender: myNameForUI,
      text,
      timestamp,
      fromRole: myRole,
    });

    input.value = '';
    input.focus();
  }

  // Events
  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    joinConversation();
  });

  inputForm.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage();
  });

  clearBtn.addEventListener('click', () => {
    messagesEl.innerHTML = '';
  });

  // Start
  connect();
})();

