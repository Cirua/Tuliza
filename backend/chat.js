// Tuliza chat (student ↔ mentor ↔ psychiatrist) using WebSocket
// Server: ws://localhost:3000/server

(function () {
  const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/server`;

  // Elements
  const chatRoot = document.getElementById('tuliza-chat');
  if (!chatRoot) return;

  const header = chatRoot.querySelector('#chat-header');
  const messagesEl = chatRoot.querySelector('#chat-messages');
  const inputForm = chatRoot.querySelector('#chat-input-form');
  const input = chatRoot.querySelector('#chat-input');
  const clearBtn = chatRoot.querySelector('#chat-clear');

  const nameInput = chatRoot.querySelector('#chat-username');

  const joinModal = chatRoot.querySelector('#chat-join-modal');
  const joinForm = chatRoot.querySelector('#chat-join-form');

  // State
  let ws;
  let myRole = null;
  let myUserId = null;
  let myDisplayName = null;
  let pendingJoinPayload = null;
  const seenMessageIds = new Set();

  // Helpers
  function roleLabel(role) {
    if (role === 'student') return 'Student';
    if (role === 'mentor') return 'Mentor';
    if (role === 'psychiatrist') return 'Psychiatrist';
    return role || '';
  }

  function addMessage({ messageId, sender, senderName, text, timestamp, fromRole }) {
    if (messageId && seenMessageIds.has(String(messageId))) return;
    if (messageId) seenMessageIds.add(String(messageId));

    const type = String(sender) === String(myUserId) ? 'user' : 'counselor';

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
    const safeSenderName = String(senderName || '').trim();
    const senderLabel = safeSenderName || safeSender;
    senderLine.textContent = `${type === 'user' ? `You (${senderLabel})` : senderLabel}${fromRole ? ` (${roleLabel(fromRole)})` : ''}`;

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
      if (pendingJoinPayload) {
        ws.send(JSON.stringify(pendingJoinPayload));
        pendingJoinPayload = null;
      }
    };

    ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (_) {
        return;
      }

      if (data.type === 'joined') {
        myRole = data.role || null;
        myDisplayName = data.displayName || data.userId;
        const peerRoleText = data.peerRole ? roleLabel(data.peerRole) : '';
        const peerName = data.peerDisplayName || data.peerUserId || 'Unassigned';
        header.textContent = `${myDisplayName} (${roleLabel(data.role)}) -> ${peerName}${peerRoleText ? ` (${peerRoleText})` : ''}`;
        return;
      }

      if (data.type === 'history') {
        const history = Array.isArray(data.messages) ? data.messages : [];
        history.forEach((entry) => addMessage(entry));
        return;
      }

      if (data.type === 'error') {
        addMessage({
          messageId: `error-${Date.now()}`,
          sender: 'System',
          text: data.reason || 'An unknown error occurred.',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // server sends: {sender, text, timestamp, fromRole, toRole}
      addMessage(data);
    };

    ws.onclose = (event) => {
      const reason = event && event.reason ? String(event.reason) : 'Connection closed';
      header.textContent = `Disconnected (${reason})`;
      addMessage({
        messageId: `ws-close-${Date.now()}`,
        sender: 'System',
        senderName: 'System',
        text: reason,
        timestamp: new Date().toISOString(),
        fromRole: null,
      });
    };
  }

  function joinConversation() {
    const username = nameInput.value.trim();

    if (!username) return;

    myUserId = username; // server uses userId as dashboard id

    // Update UI header
    const connectingName = myDisplayName || username;
    header.textContent = `${connectingName} (connecting...)`;

    // Join to the server
    let storedUser = {};
    try {
      storedUser = JSON.parse(sessionStorage.getItem('tuliza_session_user') || '{}') || {};
    } catch (_) {
      storedUser = {};
    }
    const roleHint = storedUser.role || new URLSearchParams(window.location.search).get('role') || undefined;

    const joinPayload = {
      type: 'join',
      userId: myUserId,
      authToken: sessionStorage.getItem('tuliza_session_token') || undefined,
      roleHint,
      peerUserId: new URLSearchParams(window.location.search).get('peerId') || undefined,
      peerRole: new URLSearchParams(window.location.search).get('peerRole') || undefined,
    };

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(joinPayload));
    } else {
      pendingJoinPayload = joinPayload;
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

    ws.send(
      JSON.stringify({
        type: 'message',
        sender: myUserId,
        text,
        timestamp,
      })
    );

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

  // Auto-fill from logged in user when available.
  let storedUser = null;
  try {
    storedUser = JSON.parse(sessionStorage.getItem('tuliza_session_user') || '{}');
  } catch (_) {
    storedUser = null;
  }

  const sessionUserId = storedUser?.userId || new URLSearchParams(window.location.search).get('userId') || '';
  if (sessionUserId) {
    nameInput.value = sessionUserId;
    joinConversation();
  } else {
    // Fallback for cases where session identity is unavailable.
    joinModal.style.display = 'flex';
  }
})();

