const path = require('path')
const http = require('http')
const express = require('express')
require('dotenv').config({ path: path.join(__dirname, '.env') })

const { dbPool } = require('./db/pool')
const { isAllowedOrigin } = require('./config')

const { setupFrontendRoutes } = require('./routes/frontend')
const { setupAuthRoutes } = require('./routes/auth')
const { setupWebSocket } = require('./sockets/websocket')

const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

const projectRoot = path.resolve(__dirname, '..')
const frontendRoot = path.join(projectRoot, 'frontend')

setupFrontendRoutes(app, { projectRoot, frontendRoot })
setupAuthRoutes(app, dbPool)

const server = http.createServer(app)
setupWebSocket(server, { isAllowedOrigin })

const basePort = Number(process.env.PORT) || 3000
const maxPortAttempts = 10

function startServer(port, attempt = 1) {
  const onError = (err) => {
    if (err.code === 'EADDRINUSE' && attempt < maxPortAttempts) {
      const nextPort = port + 1
      console.warn(`Port ${port} is busy, trying ${nextPort}...`)
      server.off('error', onError)
      startServer(nextPort, attempt + 1)
      return
    }

    console.error('Failed to start server:', err.message)
    process.exit(1)
  }

  server.once('error', onError)

  server.listen(port, () => {
    server.off('error', onError)
    const address = server.address()
    const activePort = typeof address === 'object' && address ? address.port : port
    const baseUrl = `http://localhost:${activePort}`

    console.log(`Server started on ${baseUrl}`)
    console.log(`Open account page: ${baseUrl}/account.html`)
  })
}

startServer(basePort)

