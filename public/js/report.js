// public/js/report.js
document.addEventListener('DOMContentLoaded', () => {
    const monthFilter = document.getElementById('month-filter');
    const employeeFilter = document.getElementById('employee-filter');
    const applyFiltersButton = document.getElementById('apply-filters');
    const reportTableBody = document.getElementById('report-table-body');
    const loadingMessage = document.getElementById('loading-message');
    const noTasksMessage = document.getElementById('no-tasks-message');
    const statusButtons = document.querySelectorAll('.status-button');

    let activeStatusFilter = 'all'; // Default filter is 'all' initially, but we'll set 'overdue' as active below

    // Function to set the active status button
    function setActiveStatusButton(status) {
        statusButtons.forEach(button => {
            if (button.dataset.status === status) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });
        activeStatusFilter = status;
    }

    // Function to fetch and display tasks
    async function fetchAndDisplayTasks() {
        reportTableBody.innerHTML = ''; // Clear existing rows
        loadingMessage.style.display = 'block';
        noTasksMessage.style.display = 'none';

        const selectedMonth = monthFilter.value;
        const selectedEmployeeId = employeeFilter.value;

        let apiUrl = '/api/tasks-report';
        const params = new URLSearchParams();

        if (selectedMonth) {
            params.append('month', selectedMonth);
        }
        if (selectedEmployeeId) {
            params.append('employeeId', selectedEmployeeId);
        }
        // Add status filter
        if (activeStatusFilter && activeStatusFilter !== 'all') {
             // If 'overdue' is selected, we pass 'overdue'. Otherwise, we pass the status name directly.
            params.append('status', activeStatusFilter);
        }

        if (params.toString()) {
            apiUrl += '?' + params.toString();
        }

        try {
            const response = await fetch(apiUrl);
            const tasks = await response.json();

            loadingMessage.style.display = 'none';

            if (tasks.length === 0) {
                noTasksMessage.style.display = 'block';
            } else {
                tasks.forEach((task, index) => {
                    const row = document.createElement('tr');

                    // Format due date
                    const dueDate = task.due_date ? new Date(task.due_date).toLocaleDateString() : 'N/A';

                    // Determine status class and text
                    let statusClass = '';
                    let statusText = task.status || 'Unknown';
                    const now = new Date();
                    const dueDateObj = task.due_date ? new Date(task.due_date) : null;

                     if (task.status === 'completed') {
                        statusClass = 'status-completed';
                        statusText = 'Completed';
                    } else if (task.status === 'pending' && dueDateObj && dueDateObj < now) {
                        statusClass = 'status-overdue';
                        statusText = 'OVERDUE';
                    } else if (task.status === 'pending') {
                         statusClass = 'status-pending';
                         statusText = 'Pending';
                    } else { // Handle any other potential statuses or unknown
                         statusClass = ''; // No specific class
                         statusText = task.status || 'Unknown';
                    }

                    row.innerHTML = `
                        <td>${index + 1}</td>
                        <td>${task.description || 'No description'}</td>
                        <td>${task.employee_name || 'Unassigned'}</td>
                        <td>${dueDate}</td>
                        <td>${task.priority || 'N/A'}</td>
                        <td class="${statusClass}">${statusText}</td>
                    `;
                    reportTableBody.appendChild(row);
                });
            }

        } catch (error) {
            console.error('Error fetching tasks:', error);
            loadingMessage.style.display = 'none';
            noTasksMessage.textContent = 'Error loading tasks.';
            noTasksMessage.style.display = 'block';
        }
    }

    // Function to populate employee filter dropdown
    async function populateEmployeeFilter() {
        try {
            const response = await fetch('/api/employees');
            const employees = await response.json();

            employees.forEach(employee => {
                const option = document.createElement('option');
                option.value = employee.id;
                option.textContent = employee.first_name + (employee.last_name ? ' ' + employee.last_name : '');
                employeeFilter.appendChild(option);
            });
        } catch (error) {
            console.error('Error fetching employees:', error);
            // Handle error, maybe keep the default 'All Employees' option
        }
    }

    // Event listener for the apply filters button
    applyFiltersButton.addEventListener('click', fetchAndDisplayTasks);

    // Event listeners for status buttons
    statusButtons.forEach(button => {
        button.addEventListener('click', () => {
            const status = button.dataset.status;
            setActiveStatusButton(status);
            fetchAndDisplayTasks(); // Fetch tasks when status button is clicked
        });
    });

    // Initial setup
    // Set 'Overdue' as the default active status filter visually and logically
    setActiveStatusButton('overdue');
    fetchAndDisplayTasks(); // Initial fetch of tasks (defaults to overdue)

    // Populate employee filter on load
    populateEmployeeFilter();

    // Initialize Telegram Mini App
    if (window.Telegram && window.Telegram.WebApp) {
        window.Telegram.WebApp.ready();
        window.Telegram.WebApp.expand(); // Expand the Mini App to full screen
    }
}); 