# 📋 Telegram Task Management Bot

## 🧠 Project Overview

A scalable Telegram bot for managing tasks, teams, and projects with role-based permissions, reminders, and approval workflows. Built with Node.js, Telegraf, and MySQL.

---

## 🚀 Features
- **Role-based**: Admin, Manager, Employee
- **Task assignment**: Create, assign, and track tasks
- **Approval workflow**: Task completion and approval
- **Reminders**: Automated reminders for due/overdue tasks
- **Deep-link onboarding**: Invite users with unique links
- **Reports**: Generate and view task reports
- **Express backend**: For static files and webhooks

---

## ⚙️ Setup Instructions

### Requirements
- Node.js v16+
- MySQL Server
- Telegram Bot Token

### Installation
1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd <project-folder>
   ```
2. **Install dependencies**
   ```bash
   npm install
   ```
3. **Configure environment**
   - Create a `.env` file:
     ```env
     TELEGRAM_BOT_TOKEN=your_telegram_token
     DB_HOST=localhost
     DB_USER=root
     DB_PASSWORD=yourpassword
     DB_NAME=task_manager
     DB_PORT=3306
     PORT=3000
     ```
   - Edit `config.js` if needed for custom settings.
4. **Initialize the database**
   - Import the SQL schema from `../Dump20250604/Dump20250604/task_manager_tasks.sql` into your MySQL server.
5. **Start the bot**
   ```bash
   npm run dev
   # or
   npm start
   ```

---

## 📁 Project Structure

```
├── app.js                # Main entry point
├── config.js             # Configuration (reads from .env)
├── package.json          # Dependencies and scripts
├── public/               # Static files (reports, HTML, CSS, JS)
│   ├── report.html
│   ├── css/
│   └── js/
├── src/
│   ├── assets/           # Fonts and other assets
│   ├── assests/          # (Typo, also fonts)
│   ├── commands/         # Telegram bot command handlers
│   │   └── index.js
│   ├── constants/        # Constants (e.g., reminder types)
│   ├── database/         # DB connection (db.js)
│   ├── handlers/         # Report and other handlers
│   ├── models/           # Data models (userModel.js, taskModel.js)
│   ├── reminders/        # Reminder scheduler (scheduler.js)
│   ├── scenes/           # Telegraf scenes (multi-step flows)
│   └── utils/            # Utilities (logger, notifications, image gen, etc.)
├── reports/              # Generated report images
├── logs/                 # Log files
└── .vscode/              # Editor config
```

### Key Files & Directories
- **app.js**: Starts Express server, initializes bot, sets up scenes and commands
- **src/commands/index.js**: Registers all bot commands and message handlers
- **src/models/userModel.js**: User DB logic (roles, registration, queries)
- **src/models/taskModel.js**: Task DB logic (CRUD, assignment, status)
- **src/scenes/**: Multi-step flows (create task, complete task, manage roles, etc.)
- **src/utils/**: Logging, notifications, image/report generation
- **src/reminders/scheduler.js**: Schedules and sends reminders
- **public/**: Static web files for reports

---

## 🧬 Database Schema (Summary)

- **users**: id, telegram_id, username, first_name, last_name, role (0=admin, 1=manager, 2=employee), manager_id, status, created_at, updated_at
- **tasks**: id, description, employee_id, assigned_by, due_date, status, completed_at, created_at, updated_at, approved_by, project_id
- **projects**: id, name, description, manager_id, start_date, end_date, status, created_at, updated_at
- **reminders**: id, task_id, reminder_type, sent_at, is_sent

> See the provided SQL file for full schema and relationships.

---

## 📝 Command Reference

| Command                | Description                                 | Access Level       |
|------------------------|---------------------------------------------|--------------------|
| `/start`               | Register and initialize user                | All                |
| `/help`                | Show list of all commands                   | All                |
| `/mytasks`             | Show all tasks assigned to you              | All                |
| `/complete`            | Mark a task as completed                    | Employee           |
| `/project`             | Create a new project                        | Manager/Admin      |
| `/task`                | Create a task under a project               | Manager/Admin      |
| `/show`                | Show all tasks (by role)                    | Admin/Manager      |
| `/approve <task_id>`   | Approve a completed task                    | Manager/Admin      |
| `/reject <task_id>`    | Reject a completed task                     | Manager/Admin      |
| `/invite`              | Generate invite link                        | Manager/Admin      |
| `/role`                | Change a user's role                        | Admin              |
| `/admin`               | Admin dashboard                             | Admin              |

---

## 👤 Roles & Permissions

| Role     | Permissions                                                                 |
|----------|------------------------------------------------------------------------------|
| Admin    | Full access, promote managers, view all data                                |
| Manager  | Assign tasks, approve completions, invite users, manage projects and teams  |
| Employee | View and complete assigned tasks                                            |

---

## 🔄 User Flow

- **Registration**: User starts bot → Role assigned → Added to DB
- **Task Creation**: Manager/Admin selects user → Enters details → Task assigned
- **Task Completion**: Employee marks done → Manager/Admin notified
- **Approval**: Manager/Admin approves/rejects → Status updated
- **Reminders**: Bot sends reminders for due/overdue tasks
- **Reports**: Generate and view reports via bot or web

---

## 🛠 Development & Customization

- **Add new commands**: Edit `src/commands/index.js`
- **Add new scenes**: Create in `src/scenes/` and register in `src/scenes/index.js`
- **Change DB logic**: Edit models in `src/models/`
- **Customize reminders**: Edit `src/reminders/scheduler.js` and `src/constants/reminderTypes.js`
- **Static web reports**: Edit files in `public/`

---

## 🆘 Troubleshooting

- **Bot not responding**: Check bot token, ensure bot is started, check logs
- **DB errors**: Ensure MySQL is running, credentials are correct, DB is initialized
- **Reminders not sent**: Check scheduler logs, ensure cron jobs are running
- **User can't use bot**: Ensure user is registered and approved

---

## 📎 Appendix

### Example `.env`
```env
TELEGRAM_BOT_TOKEN=your_token
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=password
DB_NAME=task_manager
DB_PORT=3306
PORT=3000
```

### Deployment
- See `DEPLOYMENT_HOSTINGER_VPS.md` for a full step-by-step guide to deploy on Hostinger VPS with PM2 and Nginx.

### Support
- **Developer**: Your Name
- **Email**: you@example.com
- **Telegram**: @yourhandle

---

## 📜 License
MIT (or your chosen license)
