const command = process.argv[2]

if (command === 'server') {
  require('./server')
  return
}

console.error('Unknown command. Use: node run server')
process.exit(1)
