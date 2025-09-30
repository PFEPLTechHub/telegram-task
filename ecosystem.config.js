module.exports = {
  apps: [
    {
      name: 'tel-bot',
      script: 'app.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production'
      },
      watch: false,
      max_memory_restart: '400M',
      error_file: './logs/error.log',
      out_file: './logs/combined.log',
      time: true
    }
  ]
};


