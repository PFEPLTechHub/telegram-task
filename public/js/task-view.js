// Lightweight React-like UI using Preact to avoid a build step
/* global window, document, fetch */
(function () {
  const h = window.preact.h;
  const render = window.preact.render;
  const useEffect = window.preactHooks.useEffect;
  const useState = window.preactHooks.useState;

  // Lightweight toast + confirm utilities (no deps)
  function createToastContainer() {
    let el = document.getElementById('toast-container');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast-container';
      el.className = 'tv-toast-container';
      document.body.appendChild(el);
    }
    return el;
  }
  function showToast(type, title, message, duration = 4000) {
    const container = createToastContainer();
    const toast = document.createElement('div');
    toast.className = `tv-toast ${type}`;
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    toast.innerHTML = `
      <div class="tv-toast-icon">${icons[type] || icons.info}</div>
      <div class="tv-toast-content">
        <div class="tv-toast-title">${title}</div>
        <div class="tv-toast-message">${message}</div>
      </div>
      <button class="tv-toast-close" aria-label="Close notification">×</button>
    `;
    toast.querySelector('.tv-toast-close').onclick = () => toast.remove();
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
  async function confirmDialog(message) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'tv-modal';
      overlay.innerHTML = `
        <div class="tv-modal-card" style="max-width:420px">
          <div class="tv-card-header">Confirm</div>
          <div class="tv-modal-body"><p style="margin:0;color:#212529">${message}</p></div>
          <div class="tv-modal-actions">
            <button class="tv-btn tv-btn-secondary" id="tv-cancel">Cancel</button>
            <button class="tv-btn tv-btn-primary" id="tv-ok">OK</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#tv-cancel').onclick = () => { overlay.remove(); resolve(false); };
      overlay.querySelector('#tv-ok').onclick = () => { overlay.remove(); resolve(true); };
    });
  }

  const STATUS_OPTIONS = [
    { value: 'pending', label: 'Pending' },
    { value: 'completed', label: 'Completed' },
    { value: 'overdue', label: 'Overdue' }
  ];

  const VIEW_OPTIONS = [
    { value: 'employee', label: 'Employee View' },
    { value: 'status', label: 'Status View' },
    { value: 'project', label: 'Project View' }
  ];

  const TAB_OPTIONS = [
    { value: 'reports', label: 'Reports' },
    { value: 'notes', label: 'Notes' }
  ];

  function groupBy(array, keyFn) {
    return array.reduce((map, item) => {
      const key = keyFn(item);
      if (!map[key]) map[key] = [];
      map[key].push(item);
      return map;
    }, {});
  }

  function fetchTasks(status, tgId) {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (tgId) params.set('tg_id', tgId);
    const q = params.toString() ? `?${params.toString()}` : '';
    return fetch(`/api/tasks${q}`).then(r => r.json());
  }

  function fetchNotes(tgId) {
    const params = new URLSearchParams();
    if (tgId) params.set('tg_id', tgId);
    const q = params.toString() ? `?${params.toString()}` : '';
    return fetch(`/api/notes${q}`).then(r => r.json());
  }

  function createNote(title, description, isPinned, tgId) {
    return fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, is_pinned: isPinned, tg_id: tgId })
    }).then(r => r.json());
  }

  function updateNote(noteId, updates, tgId) {
    return fetch(`/api/notes/${noteId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...updates, tg_id: tgId })
    }).then(r => r.json());
  }

  function deleteNote(noteId, tgId) {
    return fetch(`/api/notes/${noteId}?tg_id=${encodeURIComponent(tgId)}`, {
      method: 'DELETE'
    }).then(r => r.json());
  }

  function togglePin(noteId, tgId) {
    return fetch(`/api/notes/${noteId}/toggle-pin`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tg_id: tgId })
    }).then(r => r.json());
  }

  function Header({ activeTab, setActiveTab, view, setView, status, setStatus, onAutomate, disabled }) {
    return h('div', { class: 'tv-header' }, [
      h('h1', { class: 'tv-title' }, 'Task Management'),
      h('div', { class: 'tv-tabs' }, [
        TAB_OPTIONS.map(tab => 
          h('button', { 
            class: `tv-tab ${activeTab === tab.value ? 'tv-tab-active' : ''}`,
            onClick: () => setActiveTab(tab.value)
          }, tab.label)
        )
      ]),
      activeTab === 'reports' ? h('div', { class: 'tv-controls' }, [
        h('label', null, ['Select View: ',
          h('select', {
            value: view,
            onInput: e => setView(e.target.value)
          }, VIEW_OPTIONS.map(o => h('option', { value: o.value }, o.label)))
        ]),
        h('label', null, ['Filter by Status: ',
          h('select', {
            value: status,
            onInput: e => setStatus(e.target.value)
          }, STATUS_OPTIONS.map(o => h('option', { value: o.value }, o.label)))
        ]),
        h('button', { class: 'tv-automate-btn', onClick: onAutomate, disabled }, 'Automate Task')
      ]) : null
    ]);
  }

  function EmployeeView({ tasks, onItemClick, onDropAssign, team }) {
    // Group strictly by employee_id; derive labels for headers
    const idToTasks = {};
    const idToLabel = {};
    tasks.forEach(t => {
      const empId = t.employee_id;
      const isNoPerson = t.employee_username === 'no_person' || empId === 0;
      const label = isNoPerson
        ? 'No Person'
        : (t.employee_name || t.employee_username || `Employee ${empId}`);
      if (!idToTasks[empId]) {
        idToTasks[empId] = [];
        idToLabel[empId] = label;
      }
      idToTasks[empId].push(t);
    });
    // Ensure every team member appears even with zero tasks
    (team || []).forEach(member => {
      const k = String(member.id);
      if (!idToTasks[k]) {
        idToTasks[k] = [];
        idToLabel[k] = member.name;
      }
    });

    // Build stable order: put real employees first, then No Person
    const keys = Object.keys(idToTasks).sort((a,b) => {
      const la = idToLabel[a];
      const lb = idToLabel[b];
      if (la === 'No Person') return 1;
      if (lb === 'No Person') return -1;
      return la.localeCompare(lb);
    });
    return h('div', { class: 'tv-columns' }, keys.map(k => (
      h('div', { class: 'tv-card',
        'data-employee-id': k,
        onDragOver: e => e.preventDefault(),
        onDrop: e => {
          const taskId = e.dataTransfer.getData('text/task-id');
          const targetEmpId = parseInt(e.currentTarget.getAttribute('data-employee-id'),10);
          if (taskId && Number.isFinite(targetEmpId)) onDropAssign(parseInt(taskId,10), targetEmpId);
        }
      }, [
        h('div', { class: 'tv-card-header' }, idToLabel[k]),
        ...(idToTasks[k].length ? idToTasks[k].map(t => h('div', { class: 'tv-item', draggable: true,
          onDragStart: ev => ev.dataTransfer.setData('text/task-id', String(t.id)),
          onClick: () => onItemClick(t) }, t.description)) : [
          h('div', { class: 'tv-empty' }, 'No tasks')
        ])
      ])
    )));
  }

  function StatusView({ tasks, onItemClick }) {
    const groups = {
      overdue: tasks.filter(t => t.status === 'overdue'),
      pending: tasks.filter(t => t.status === 'pending'),
      completed: tasks.filter(t => t.status === 'completed')
    };
    const order = ['overdue', 'pending', 'completed'];
    const titles = { overdue: 'Overdue', pending: 'Pending', completed: 'Completed' };
    return h('div', { class: 'tv-columns' }, order.map(s => (
      h('div', { class: 'tv-card' }, [
        h('div', { class: 'tv-card-header' }, titles[s]),
        ...(groups[s].length ? groups[s].map(t => h('div', { class: 'tv-item', onClick: () => onItemClick(t) }, t.description)) : [
          h('div', { class: 'tv-empty' }, 'No tasks')
        ])
      ])
    )));
  }

  function ProjectView({ tasks, onItemClick, projects }) {
    const groups = groupBy(tasks, t => t.project_id || 'none');
    const ordered = (projects || []).map(p => ({ id: p.id, name: p.name })).concat([{ id: 'none', name: 'Miscellaneous Tasks' }]);
    return h('div', { class: 'tv-columns scroll-x' }, ordered.map(p => (
      h('div', { class: 'tv-card' }, [
        h('div', { class: 'tv-card-header' }, p.name),
        ...((groups[p.id] || []).length ? (groups[p.id] || []).map(t => h('div', { class: 'tv-item', onClick: () => onItemClick(t) }, t.description)) : [
          h('div', { class: 'tv-empty' }, 'No tasks for selected status')
        ])
      ])
    )));
  }

  function NotesView({ notes, onNoteClick, onDeleteNote, onTogglePin, onCreateNote, canCreate, readOnly }) {
    return h('div', { class: 'tv-notes-container' }, [
      h('div', { class: 'tv-notes-header' }, [
        canCreate ? h('button', { class: 'tv-create-note-btn', onClick: onCreateNote }, 'Create Note') : null
      ]),
      h('div', { class: 'tv-notes-grid' }, 
        notes.length > 0 ? notes.map(note => 
          h('div', { 
            class: `tv-note-card ${note.is_pinned ? 'tv-note-pinned' : ''}`,
            onClick: () => { if (!readOnly) onNoteClick(note); }
          }, [
            h('div', { class: 'tv-note-header' }, [
              h('h3', { class: 'tv-note-title' }, note.title),
              h('div', { class: 'tv-note-actions' }, [
                !readOnly ? h('button', { 
                  class: `tv-pin-btn ${note.is_pinned ? 'tv-pinned' : ''}`,
                  onClick: (e) => {
                    e.stopPropagation();
                    onTogglePin(note.id);
                  }
                }, note.is_pinned ? '📌' : '📍') : null,
                !readOnly ? h('button', { 
                  class: 'tv-delete-btn',
                  onClick: (e) => {
                    e.stopPropagation();
                    onDeleteNote(note.id);
                  }
                }, '🗑️') : null
              ])
            ]),
            h('div', { class: 'tv-note-content' }, note.description),
            h('div', { class: 'tv-note-footer' }, [
              h('span', { class: 'tv-note-date' }, new Date(note.updated_at).toLocaleDateString())
            ])
          ])
        ) : [
          h('div', { class: 'tv-empty-notes' }, [
            h('p', null, 'No notes yet'),
            canCreate ? h('p', null, 'Click "Create Note" to get started') : null
          ])
        ]
      )
    ]);
  }

  function NoteModal({ note, onClose, onSave }) {
    if (!note) return null;
    let titleInput, descInput, pinInput;
    
    setTimeout(() => {
      if (titleInput) titleInput.value = note.title || '';
      if (descInput) descInput.value = note.description || '';
      if (pinInput) pinInput.checked = note.is_pinned || false;
    });

    return h('div', { class: 'tv-modal' }, [
      h('div', { class: 'tv-modal-card tv-note-modal' }, [
        h('div', { class: 'tv-card-header' }, note.id ? 'Edit Note' : 'Create Note'),
        h('div', { class: 'tv-modal-body' }, [
          h('label', null, ['Title', h('input', { ref: r => titleInput = r, type: 'text', placeholder: 'Enter note title' })]),
          h('label', null, ['Description', h('textarea', { ref: r => descInput = r, placeholder: 'Enter note description', rows: 6 })]),
          h('label', { class: 'tv-checkbox-label' }, [
            h('input', { ref: r => pinInput = r, type: 'checkbox' }),
            ' Pin this note'
          ])
        ]),
        h('div', { class: 'tv-modal-actions' }, [
          h('button', { class: 'tv-btn tv-btn-secondary', onClick: onClose }, 'Cancel'),
          h('button', { class: 'tv-btn tv-btn-primary', onClick: (e) => {
            const btn = e.currentTarget;
            if (btn.disabled) return;
            const old = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> Saving...';
            Promise.resolve(onSave({
              title: titleInput.value,
              description: descInput.value,
              is_pinned: pinInput.checked
            })).finally(() => { btn.disabled = false; btn.innerHTML = old; });
          } }, 'Save')
        ])
      ])
    ]);
  }

  function Modal({ task, onClose, onSave, team }) {
    if (!task) return null;
    let descInput, dateInput, statusInput, priorityInput, projectInput, ccContainer;
    function toLocalYMD(value){
      if(!value) return '';
      const d = new Date(value);
      const y = d.getFullYear();
      const m = String(d.getMonth()+1).padStart(2,'0');
      const da = String(d.getDate()).padStart(2,'0');
      return `${y}-${m}-${da}`;
    }
    setTimeout(async () => {
      if (descInput) descInput.value = task.description || '';
      if (dateInput && task.due_date) dateInput.value = toLocalYMD(task.due_date);
      if (statusInput) statusInput.value = (task.status || 'pending').toLowerCase();
      if (priorityInput) {
        const normalizedPriority = (task.priority || '').toString().toLowerCase();
        priorityInput.value = ['low','medium','high'].includes(normalizedPriority) ? normalizedPriority : '';
      }
      if (projectInput) {
        try {
          const projects = await fetch('/api/projects').then(r => r.json());
          // Populate project select
          projectInput.innerHTML = '';
          const none = document.createElement('option');
          none.value = '';
          none.textContent = 'None';
          projectInput.appendChild(none);
          projects.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            projectInput.appendChild(opt);
          });
          projectInput.value = task.project_id || '';
        } catch (_) {}
      }
      if (ccContainer) {
        // Populate CC checkboxes with team members
        ccContainer.innerHTML = '';
        (team || []).forEach(member => {
          const label = document.createElement('label');
          label.className = 'tv-checkbox-label';
          
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.value = member.id;
          checkbox.checked = task.ccUsers && task.ccUsers.some(cc => cc.user_id == member.id);
          
          const span = document.createElement('span');
          span.textContent = member.name;
          
          label.appendChild(checkbox);
          label.appendChild(span);
          ccContainer.appendChild(label);
        });
      }
    });
    return h('div', { class: 'tv-modal' }, [
      h('div', { class: 'tv-modal-card' }, [
        h('div', { class: 'tv-card-header' }, 'Edit Task'),
        h('div', { class: 'tv-modal-body' }, [
          h('label', null, ['Description', h('input', { ref: r => descInput = r, type: 'text' })]),
          h('label', null, ['Due Date', h('input', { ref: r => dateInput = r, type: 'date' })]),
          h('label', null, ['Status', h('select', { ref: r => statusInput = r }, [
            h('option', { value: 'pending' }, 'Pending'),
            h('option', { value: 'completed' }, 'Completed'),
            h('option', { value: 'overdue' }, 'Overdue'),
            h('option', { value: 'active' }, 'Active')
          ])]),
          h('label', null, ['Priority', h('select', { ref: r => priorityInput = r }, [
            h('option', { value: '' }, 'None'),
            h('option', { value: 'low' }, 'Low'),
            h('option', { value: 'medium' }, 'Medium'),
            h('option', { value: 'high' }, 'High')
          ])]),
          h('label', null, ['Project', h('select', { ref: r => projectInput = r }, [])]),
          h('div', { class: 'tv-cc-section' }, [
            h('label', { class: 'tv-cc-label' }, 'CC Users'),
            h('div', { ref: r => ccContainer = r, class: 'tv-cc-checkboxes' })
          ])
        ]),
        h('div', { class: 'tv-modal-actions' }, [
          h('button', { class: 'tv-btn tv-btn-secondary', onClick: onClose }, 'Cancel'),
          h('button', { class: 'tv-btn tv-btn-primary', onClick: (e) => {
            const btn = e.currentTarget;
            if (btn.disabled) return;
            const old = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> Saving...';
            const selectedCcIds = Array.from(ccContainer.querySelectorAll('input[type="checkbox"]:checked'))
              .map(cb => parseInt(cb.value, 10));
            Promise.resolve(onSave({ 
              description: descInput.value, 
              due_date: dateInput.value ? new Date(dateInput.value).toISOString().slice(0,10) : null, 
              status: statusInput.value, 
              priority: priorityInput.value || null, 
              project_id: projectInput.value ? parseInt(projectInput.value,10) : null,
              cc_user_ids: selectedCcIds
            })).finally(() => { btn.disabled = false; btn.innerHTML = old; });
          }}, 'Save')
        ])
      ])
    ]);
  }

  function App() {
    const [activeTab, setActiveTab] = useState('reports');
    const [view, setView] = useState('employee');
    const [status, setStatus] = useState('pending');
    const [tasks, setTasks] = useState([]);
    const [noPersonCount, setNoPersonCount] = useState(0);
    const [team, setTeam] = useState([]);
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null);
    const [canAutomate, setCanAutomate] = useState(false);
    
    // Notes state
    const [notes, setNotes] = useState([]);
    const [notesLoading, setNotesLoading] = useState(false);
    const [editingNote, setEditingNote] = useState(null);

    useEffect(() => {
      const url = new URL(window.location.href);
      const tgId = url.searchParams.get('tg_id');
      
      if (activeTab === 'reports') {
        setLoading(true);
        fetchTasks(status, tgId).then(data => {
          setTasks(data.tasks || []);
          setNoPersonCount((data.meta && data.meta.noPersonCount) || 0);
          
          // Check if automation is possible
          const hasNoPersonTasks = (data.meta && data.meta.noPersonCount) > 0;
          setCanAutomate(hasNoPersonTasks);
          
          setLoading(false);
        }).catch(() => setLoading(false));
        // Load team list
        fetch(`/api/team?tg_id=${encodeURIComponent(tgId || '')}`).then(r => r.json()).then(setTeam).catch(()=>{});
        // Load projects scoped to viewer
        fetch(`/api/projects?tg_id=${encodeURIComponent(tgId || '')}`).then(r => r.json()).then(setProjects).catch(()=>{});
      } else if (activeTab === 'notes') {
        setNotesLoading(true);
        fetchNotes(tgId).then(data => {
          setNotes(data || []);
          setNotesLoading(false);
        }).catch(() => setNotesLoading(false));
      }
    }, [status, activeTab]);

    // Notes event handlers
    const onNoteClick = (note) => setEditingNote(note);
    const onCreateNote = () => setEditingNote({});
    const onDeleteNote = async (noteId) => {
      const url = new URL(window.location.href);
      const tgId = url.searchParams.get('tg_id');
      const ok = await confirmDialog('Are you sure you want to delete this note?');
      if (!ok) return;
      try {
        await deleteNote(noteId, tgId);
        const arr = Array.isArray(notes) ? notes : (notes && notes.notes) || [];
        const next = arr.filter(n => n.id !== noteId);
        setNotes(Array.isArray(notes) ? next : { ...notes, notes: next });
        showToast('success', 'Note Deleted', 'The note has been deleted.');
      } catch (e) {
        showToast('error', 'Delete Failed', e.message || 'Failed to delete note');
      }
    };
    const onTogglePin = async (noteId) => {
      const url = new URL(window.location.href);
      const tgId = url.searchParams.get('tg_id');
      try {
        const updatedNote = await togglePin(noteId, tgId);
        const arr = Array.isArray(notes) ? notes : (notes && notes.notes) || [];
        const next = arr.map(n => n.id === noteId ? updatedNote : n);
        setNotes(Array.isArray(notes) ? next : { ...notes, notes: next });
        showToast('success', 'Note Updated', updatedNote.is_pinned ? 'Note pinned successfully' : 'Note unpinned successfully');
      } catch (e) {
        showToast('error', 'Update Failed', e.message || 'Failed to toggle pin status');
      }
    };

    let content = null;
    const onItemClick = (t) => setEditing(t);
    
    if (activeTab === 'notes') {
      if (notesLoading) content = h('div', { class: 'tv-loading' }, 'Loading notes...');
      else content = h(NotesView, { notes: (notes.notes || notes), onNoteClick, onDeleteNote, onTogglePin, onCreateNote, canCreate: !!(notes.meta && notes.meta.canCreate), readOnly: !(notes.meta && notes.meta.canManage) });
    } else {
      if (loading) content = h('div', { class: 'tv-loading' }, 'Loading...');
      else if (view === 'employee') content = h(EmployeeView, { tasks, onItemClick, team, onDropAssign: async (taskId, employeeId) => {
        const url = new URL(window.location.href);
        const tgId = url.searchParams.get('tg_id');
        // Allow without tgId (server will fall back), but log for visibility
        if (!tgId) console.warn('Missing tgId; proceeding with server fallback');
        await fetch(`/api/tasks/${taskId}/assign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to_employee_id: employeeId, by_tg_id: tgId || undefined }) });
        // refresh
        setLoading(true);
        fetchTasks(status, tgId).then(data => { setTasks(data.tasks || []); setLoading(false); }).catch(() => setLoading(false));
      } });
      else if (view === 'status') content = h(StatusView, { tasks, onItemClick });
      else content = h(ProjectView, { tasks, onItemClick, projects });
    }

    const onAutomate = async () => {
      const url = new URL(window.location.href);
      const tgId = url.searchParams.get('tg_id');
      try {
        const res = await fetch('/api/automate-tasks', { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' }, 
          body: JSON.stringify({ by_tg_id: tgId }) 
        });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error || 'Automation failed');
          if (data.details) {
            console.log('Automation details:', data.details);
          }
          return;
        }
        
        // Show success message
        alert(data.message || 'Tasks automated successfully!');
        
        // Refresh the task list
        setLoading(true);
        fetchTasks(status, tgId).then(data => { 
          setTasks(data.tasks || []); 
          setNoPersonCount((data.meta && data.meta.noPersonCount) || 0);
          
          // Update automation availability
          const hasNoPersonTasks = (data.meta && data.meta.noPersonCount) > 0;
          setCanAutomate(hasNoPersonTasks);
          
          setLoading(false); 
        }).catch(() => setLoading(false));
        
      } catch (e) {
        alert('Automation failed: ' + e.message);
      }
    };

    return h('div', { class: 'tv-container' }, [
      h(Header, { activeTab, setActiveTab, view, setView, status, setStatus, onAutomate, disabled: !canAutomate }),
      content,
      h(Modal, { task: editing, team, onClose: () => setEditing(null), onSave: async (fields) => {
        try {
          const url = new URL(window.location.href);
          const tgId = url.searchParams.get('tg_id');
          
          // Update task fields
          const res = await fetch(`/api/tasks/${editing.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...fields, by_tg_id: tgId }) });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'Failed to save');
          
          // Update CC if provided
          if (fields.cc_user_ids !== undefined) {
            const ccRes = await fetch(`/api/tasks/${editing.id}/cc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cc_user_ids: fields.cc_user_ids, tg_id: tgId }) });
            const ccData = await ccRes.json().catch(() => ({}));
            if (!ccRes.ok) {
              console.warn('Failed to update CC:', ccData.error);
            }
          }
          
          showToast('success', 'Task Saved', 'Task has been successfully updated.');
        } catch (e) {
          showToast('error', 'Save Failed', e.message || 'Save failed');
        }
        setEditing(null);
        // Refresh
        const url = new URL(window.location.href);
        const tgId = url.searchParams.get('tg_id');
        setLoading(true);
        fetchTasks(status, tgId).then(data => { setTasks(data.tasks || []); setLoading(false); }).catch(() => setLoading(false));
      } }),
      h(NoteModal, { note: editingNote, onClose: () => setEditingNote(null), onSave: async (fields) => {
        try {
          const url = new URL(window.location.href);
          const tgId = url.searchParams.get('tg_id');
          let result;
          if (editingNote.id) {
            // Update existing note
            result = await updateNote(editingNote.id, fields, tgId);
          } else {
            // Create new note
            result = await createNote(fields.title, fields.description, fields.is_pinned, tgId);
          }
          setEditingNote(null);
          // Refresh notes
          const updatedNotes = await fetchNotes(tgId);
          setNotes(updatedNotes || []);
          showToast('success', 'Note Saved', 'Note has been successfully saved!');
        } catch (e) {
          showToast('error', 'Save Failed', e.message || 'Failed to save note');
        }
      } })
    ]);
  }

  function mount() { render(h(App, null), document.getElementById('root')); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else mount();
})();


