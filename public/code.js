// @ts-nocheck

// Create a WebSocket connection
const ws = new WebSocket('ws://localhost:3000/server')

ws.onmessage = (event) => {
  let message
  try {
    message = JSON.parse(event.data)
  } catch (_) {
    return
  }

  chatMessages.appendChild(createChatMessageElement(message))
  chatMessages.scrollTop = chatMessages.scrollHeight
}

// Elements
const userInfoModal = document.querySelector('.user-info-modal')
const userInfoForm = document.querySelector('.user-info-form')
const chatHeader = document.querySelector('.chat-header')
const chatMessages = document.querySelector('.chat-messages')
const chatInputForm = document.querySelector('.chat-input-form')
const chatInput = document.querySelector('.chat-input')
const clearChatBtn = document.querySelector('.clear-chat-button')

let messageSender = ''
let chatCode = ''
let myRole = ''
let myUserId = ''

const createChatMessageElement = (message) => {
  // message contains: sender, text, timestamp, fromRole/toRole
  const sender = String(message?.sender ?? 'Unknown')
  const fromRole = String(message?.fromRole ?? '')
  const text = String(message?.text ?? '')
  const timestamp = String(message?.timestamp ?? '')

  const wrap = document.createElement('div')
  wrap.className = `message ${sender === messageSender ? 'blue-bg' : 'gray-bg'}`

  const senderEl = document.createElement('div')
  senderEl.className = 'message-sender'
  senderEl.textContent = fromRole ? `${sender} (${fromRole})` : sender

  const textEl = document.createElement('div')
  textEl.className = 'message-text'
  textEl.textContent = text

  const timestampEl = document.createElement('div')
  timestampEl.className = 'message-timestamp'
  timestampEl.textContent = timestamp

  wrap.appendChild(senderEl)
  wrap.appendChild(textEl)
  wrap.appendChild(timestampEl)
  return wrap
}

const updateMessageSender = (name, code, role) => {
  messageSender = name
  chatCode = code
  myRole = role

  // For simplicity, userId = username
  myUserId = name

  chatHeader.innerText = `${name} (${role}) chatting in code: ${code}`
  chatInput.placeholder = `Type here, ${messageSender}...`

  /* auto-focus the input field */
  chatInput.focus()
}

userInfoForm.addEventListener('submit', (e) => {
  e.preventDefault()
  const username = e.target.username.value
  const code = e.target.chatCode?.value || ''

  // role field is optional; fallback to 'student'
  const role = e.target.role ? e.target.role.value : 'student'

  updateMessageSender(username, code, role)

  // JOIN with userId+role so server can route messages only to this dashboard
  ws.send(JSON.stringify({
    type: 'join',
    userId: myUserId,
    role: myRole,
  }))
  userInfoModal.style.display = 'none'
})

const sendMessage = (e) => {
  e.preventDefault()

  const timestamp = new Date().toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true })

  const text = chatInput.value

  // DESTINATION RULES:
  // - Student sends to mentors + psychiatrists dashboards (so toUserId is undefined)
  // - Mentor/Psychiatrist sends back to the student dashboard (toUserId is the student username)
  //   (You can extend this UI later; for now, we read targetStudent from an input if present.)

  const targetStudent = document.querySelector('#targetStudent')?.value?.trim() || ''

  if (text.trim().length === 0) return

  let payload
  if (myRole === 'student') {
    // Deliver to ALL mentors and ALL psychiatrists in this chatCode.
    // We send two messages (one per role) so both dashboards get it.
    payload = {
      sender: messageSender,
      text,
      timestamp,
      chatCode,
      fromRole: 'student',
      toRole: 'mentor',
      // toUserId intentionally omitted
    }
    ws.send(JSON.stringify(payload))

    ws.send(
      JSON.stringify({
        ...payload,
        toRole: 'psychiatrist',
      })
    )
  } else {
    // mentor/psychiatrist -> one specific student
    if (!targetStudent) return

    payload = {
      sender: messageSender,
      text,
      timestamp,
      chatCode,
      fromRole: myRole,
      toRole: 'student',
      toUserId: targetStudent,
    }
    ws.send(JSON.stringify(payload))
  }

  chatInputForm.reset()
  chatMessages.scrollTop = chatMessages.scrollHeight
}

chatInputForm.addEventListener('submit', sendMessage)

clearChatBtn.addEventListener('click', () => {
  localStorage.clear()
  chatMessages.innerHTML = ''
})
