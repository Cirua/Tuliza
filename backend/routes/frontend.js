const path = require('path')
const fs = require('fs')

function setupFrontendRoutes(app, { projectRoot, frontendRoot }) {
  function resolveFrontendHtml(page) {
    const normalizedPage = String(page || '').trim()
    if (!normalizedPage.endsWith('.html')) return null
    if (path.basename(normalizedPage) !== normalizedPage) return null

    const filePath = path.join(frontendRoot, normalizedPage)
    return fs.existsSync(filePath) ? filePath : null
  }

  /* Serve frontend assets (styles/scripts/media) from root URL */
  app.use(require('express').static(frontendRoot))

  /* Serve static files from the root directory */
  app.use(require('express').static(projectRoot))


  app.get('/', (req, res) => {
    res.sendFile(path.join(projectRoot, 'frontend', 'account.html'))
  })

  // Support clean page URLs such as /chat-ui.html used by navbar links.
  app.get('/:page', (req, res, next) => {
    const { page } = req.params
    const frontendFile = resolveFrontendHtml(page)
    if (!frontendFile) {
      next()
      return
    }
    res.sendFile(frontendFile)
  })

  // Keep compatibility with direct /frontend/*.html links.
  app.get('/frontend/:page', (req, res, next) => {
    const { page } = req.params
    const frontendFile = resolveFrontendHtml(page)
    if (!frontendFile) {
      next()
      return
    }
    res.sendFile(frontendFile)
  })

  /* Route to indicate chat server is running */
  app.get('/server', (req, res) => {
    res.send('Chat server running')
  })
}

module.exports = { setupFrontendRoutes }

