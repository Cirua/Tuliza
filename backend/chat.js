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

  const nameInput = chatRoot.querySelector('#chat-username');

  const joinModal = chatRoot.querySelector('#chat-join-modal');
  const joinForm = chatRoot.querySelector('#chat-join-form');
  const peersWrap = document.createElement('div');
  peersWrap.style.margin = '12px 0';
  peersWrap.style.display = 'none';
  peersWrap.innerHTML = '<strong>Conversations</strong><div id="peer-list" style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"></div>';
  chatRoot.insertBefore(peersWrap, messagesEl);
  const peerList = peersWrap.querySelector('#peer-list');

  // State
  let ws;
  let myRole = null;
  let myUserId = null;
  let activePeer = { userId: null, role: null };
  const seenMessageIds = new Set();

  // Helpers
  function roleLabel(role) {
    if (role === 'student') return 'Student';
    if (role === 'mentor') return 'Mentor';
    if (role === 'psychiatrist') return 'Psychiatrist';
    return role || '';
  }

  function addMessage({ messageId, sender, text, timestamp, fromRole }) {
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

      if (data.type === 'joined') {
        myRole = data.role || null;
        const peer = data.peerUserId ? ` -> ${data.peerUserId}` : '';
        header.textContent = `${data.userId} (${roleLabel(data.role)})${peer}`;
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

    ws.onclose = () => {
      // Keep UI simple; just log.
      // If needed, we can show a retry message.
      console.warn('WebSocket closed');
    };
  }

  async function loadPeersFromDb(role, userId) {
    if (role !== 'mentor' && role !== 'psychiatrist') return;
    try {
      const response = await fetch(`/api/chat/peers?role=${encodeURIComponent(role)}&userId=${encodeURIComponent(userId)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(payload.peers)) return;
      if (payload.peers.length === 0) return;

      peersWrap.style.display = '';
      peerList.innerHTML = '';
      payload.peers.forEach((peer) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-ghost-modal';
        btn.textContent = `${peer.peer_role} ${peer.peer_user_id}`;
        btn.addEventListener('click', () => {
          activePeer = { userId: String(peer.peer_user_id), role: String(peer.peer_role) };
          joinConversation();
        });
        peerList.appendChild(btn);
      });

      if (!activePeer.userId && payload.peers[0]) {
        activePeer = { userId: String(payload.peers[0].peer_user_id), role: String(payload.peers[0].peer_role) };
      }
    } catch (_) {
      // Ignore peer list errors and allow default join flow.
    }
  }

  function joinConversation() {
    const username = nameInput.value.trim();

    if (!username) return;

    myUserId = username; // server uses userId as dashboard id

    // Update UI header
    header.textContent = `${username} (connecting...)`;

    // Join to the server
    let storedUser = {};
    try {
      storedUser = JSON.parse(sessionStorage.getItem('tuliza_session_user') || '{}') || {};
    } catch (_) {
      storedUser = {};
    }
    const roleHint = storedUser.role || new URLSearchParams(window.location.search).get('role') || undefined;

    ws.send(
      JSON.stringify({
        type: 'join',
        userId: myUserId,
        authToken: sessionStorage.getItem('tuliza_session_token') || undefined,
        roleHint,
        peerUserId: activePeer.userId || new URLSearchParams(window.location.search).get('peerId') || undefined,
        peerRole: activePeer.role || new URLSearchParams(window.location.search).get('peerRole') || undefined,
      })
    );

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
    loadPeersFromDb(storedUser?.role, sessionUserId).finally(() => {
      joinConversation();
    });
  }
})();

