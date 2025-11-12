document.addEventListener('DOMContentLoaded', () => {
    // ----------------------------------------------------------------
    // STATE MANAGEMENT
    // ----------------------------------------------------------------
    let characters = {};
    let currentCharacterId = null;
    let selectedNodeIds = new Set();
    let selectedCharacterIds = new Set();
    let isDragging = false, hasDragged = false, draggedElement = null;
    let editingNodeId = null, editingCharacterId = null, connectingState = null;
    
    // History Management
    let history = [];
    let historyIndex = -1;

    // ----------------------------------------------------------------
    // LOCAL STORAGE (INDEXEDDB)
    // ----------------------------------------------------------------
    let db;
    const DB_NAME = 'DialogueEditorDB';
    const STORE_NAME = 'charactersStore';
    const DATA_KEY = 'mainCharacterData';

    function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = event => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
            request.onsuccess = event => {
                db = event.target.result;
                console.log("Database initialized successfully.");
                resolve(db);
            };
            request.onerror = event => {
                console.error("Database error:", event.target.error);
                reject(event.target.error);
            };
        });
    }

    function saveData(data) {
        if (!db) return;
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        // We use JSON.stringify because IndexedDB can have issues with complex objects (like Sets)
        store.put(JSON.stringify(data), DATA_KEY);
    }

    function loadData() {
        return new Promise((resolve, reject) => {
            if (!db) {
                reject("Database not initialized.");
                return;
            }
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(DATA_KEY);

            request.onsuccess = event => {
                if (event.target.result) {
                    resolve(JSON.parse(event.target.result));
                } else {
                    resolve(null); // No data found
                }
            };

            request.onerror = event => {
                console.error("Error loading data:", event.target.error);
                reject(event.target.error);
            };
        });
    }

    // ----------------------------------------------------------------
    // ELEMENT SELECTORS
    // ----------------------------------------------------------------
    const homePage = document.getElementById('home-page'), 
          dialogueEditorPage = document.getElementById('dialogue-editor-page'), 
          homeCanvas = document.getElementById('home-canvas'), 
          editorCanvas = document.getElementById('editor-canvas'), 
          connectorLines = document.getElementById('connector-lines'), 
          characterHeaderName = document.getElementById('character-header-name'), 
          homeBtn = document.getElementById('home-btn'), 
          addCharacterTool = document.getElementById('add-character-tool'), 
          addNodeTool = document.getElementById('add-node-tool'), 
          characterColorTool = document.getElementById('character-color-tool'), 
          characterColorPicker = document.getElementById('character-color-picker'), 
          nodeColorTool = document.getElementById('node-color-tool'), 
          nodeColorPicker = document.getElementById('node-color-picker'), 
          popupOverlay = document.getElementById('popup-overlay'), 
          optionPopup = document.getElementById('option-popup'), 
          closePopupButtons = document.querySelectorAll('.close-popup'), 
          saveCharacterBtn = document.getElementById('save-character-btn'), 
          saveCharacterInfoBtn = document.getElementById('save-character-info-btn'), 
          saveOptionBtn = document.getElementById('save-option-btn'), 
          saveNodeInfoBtn = document.getElementById('save-node-info-btn'), 
          dialogueLabel = document.getElementById('dialogue-label'), 
          undoBtn = document.getElementById('undo-btn'), 
          redoBtn = document.getElementById('redo-btn');

    

    // --- Event Listeners ---
    document.addEventListener('keydown', handleKeyPress);
    document.addEventListener('mousedown', startAction);
    document.addEventListener('mousemove', moveAction);
    document.addEventListener('mouseup', endAction);
    homeBtn.addEventListener('click', showHomePage);
    addCharacterTool.addEventListener('click', () => openPopup('create-character-popup'));
    addNodeTool.addEventListener('click', setupAndOpenRootNodePopup);
    saveCharacterBtn.addEventListener('click', createCharacter);
    characterColorPicker.addEventListener('input', changeSelectedCharacterColors);
    nodeColorPicker.addEventListener('input', changeSelectedNodeColors);
    saveOptionBtn.addEventListener('click', saveOptionOrRootNode);
    saveNodeInfoBtn.addEventListener('click', saveNodeInfo);
    saveCharacterInfoBtn.addEventListener('click', saveCharacterInfo);
    closePopupButtons.forEach(btn => btn.addEventListener('click', closePopups));
    homeCanvas.addEventListener('click', (e) => { if (e.target === homeCanvas) deselectAllCharacters(); });
    editorCanvas.addEventListener('click', (e) => { if (e.target === editorCanvas) deselectAllNodes(); });


    // ----------------------------------------------------------------
    // FUNCTION DEFINITIONS
    // ----------------------------------------------------------------

    // --- History Functions ---
    const saveState = () => {
        history = history.slice(0, historyIndex + 1);
        const state = JSON.parse(JSON.stringify(characters));
        history.push(state);
        historyIndex++;
        updateUndoRedoButtons();
        saveData(state); // Save to IndexedDB on every state change
    };

    const undo = () => {
        if (undoBtn.classList.contains('disabled')) return;
        historyIndex--;
        const state = history[historyIndex];
        loadState(state);
        saveData(state); // Save the undone state to DB
    };
    
    const redo = () => {
        if (redoBtn.classList.contains('disabled')) return;
        historyIndex++;
        const state = history[historyIndex];
        loadState(state);
        saveData(state); // Save the redone state to DB
    };
    
    const loadState = (state) => {
        characters = JSON.parse(JSON.stringify(state));
        if (currentCharacterId && characters[currentCharacterId]) {
            renderDialogue();
        } else {
            showHomePage();
            renderCharacters();
        }
        updateUndoRedoButtons();
    };
    
    const updateUndoRedoButtons = () => {
        undoBtn.classList.toggle('disabled', historyIndex <= 0);
        redoBtn.classList.toggle('disabled', historyIndex >= history.length - 1);
    };

    // --- Utility ---
    const getContrastColor = (hex) => { if(hex.startsWith('#'))hex=hex.slice(1); const r=parseInt(hex.substr(0,2),16),g=parseInt(hex.substr(2,2),16),b=parseInt(hex.substr(4,2),16); return ((r*299)+(g*587)+(b*114))/1000>=128?'#000':'#fff'; };

    // --- Action Handlers ---
    function startAction(e) {
        if (e.target.classList.contains('connection-handle')) {
            const fromNodeEl = e.target.closest('.dialogue-node');
            const fromRect = fromNodeEl.getBoundingClientRect();
            const canvasRect = editorCanvas.getBoundingClientRect();
            const x1 = fromRect.left + fromRect.width / 2 - canvasRect.left;
            const y1 = fromRect.top + fromRect.height / 2 - canvasRect.top;
            connectingState = { from: fromNodeEl.id, x1, y1 };
            const previewLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            previewLine.id = 'preview-line';
            previewLine.setAttribute('x1', x1);
            previewLine.setAttribute('y1', y1);
            previewLine.setAttribute('x2', e.clientX - canvasRect.left);
            previewLine.setAttribute('y2', e.clientY - canvasRect.top);
            previewLine.setAttribute('stroke', '#555');
            previewLine.setAttribute('stroke-width', '2');
            previewLine.setAttribute('stroke-dasharray', '5,5');
            previewLine.setAttribute('marker-end', 'url(#arrow)');
            connectorLines.appendChild(previewLine);
            e.stopPropagation();
            return;
        }
        const target = e.target.closest('.character-node, .dialogue-node');
        if (target) {
            isDragging = true;
            draggedElement = target;
            dragOffsetX = e.clientX - target.offsetLeft;
            dragOffsetY = e.clientY - target.offsetTop;
        }
    }

    function moveAction(e) {
        if (connectingState) {
            const previewLine = document.getElementById('preview-line');
            if (previewLine) {
                const canvasRect = editorCanvas.getBoundingClientRect();
                previewLine.setAttribute('x2', e.clientX - canvasRect.left);
                previewLine.setAttribute('y2', e.clientY - canvasRect.top);
            }
            return;
        }
        if (!isDragging) return;
        e.preventDefault();
        hasDragged = true;
        // Clamp dragging so you can't move past top/left edges
        let x = e.clientX - dragOffsetX;
        let y = e.clientY - dragOffsetY;

        // Prevent dragging beyond 0,0
        x = Math.max(0, x);
        y = Math.max(0, y);

        const buffer = 200;
        const canvas = currentCharacterId ? editorCanvas : homeCanvas;
        if (x + draggedElement.offsetWidth > canvas.offsetWidth - buffer) {
            canvas.style.width = `${canvas.offsetWidth + 1000}px`;
        }
        if (y + draggedElement.offsetHeight > canvas.offsetHeight - buffer) {
            canvas.style.height = `${canvas.offsetHeight + 1000}px`;
        }

        draggedElement.style.left = `${x}px`;
        draggedElement.style.top = `${y}px`;
        if (currentCharacterId && draggedElement.classList.contains('dialogue-node')) {
            updateLines();
        }
    }

    function endAction(e) {
        if (connectingState) {
            document.getElementById('preview-line')?.remove();
            const target = e.target.closest('.dialogue-node');
            if (target && target.id !== connectingState.from) {
                characters[currentCharacterId].dialogue.connections.push({ from: connectingState.from, to: target.id, text: "Option" });
                saveState();
                updateLines();
            } else if (!target || target.id === connectingState.from) {
                const canvasRect = editorCanvas.getBoundingClientRect();
                connectingState.endX = e.clientX - canvasRect.left;
                connectingState.endY = e.clientY - canvasRect.top;
                setupAndOpenOptionPopup(connectingState.from);
            }
            if (!target || target.id === connectingState.from) return;
            connectingState = null;
            return;
        }
        if (isDragging && hasDragged) {
            const id = draggedElement.id;
            const x = draggedElement.offsetLeft, y = draggedElement.offsetTop;
            if (draggedElement.classList.contains('character-node')) {
                characters[id].x = x; characters[id].y = y;
            } else {
                characters[currentCharacterId].dialogue.nodes[id].x = x;
                characters[currentCharacterId].dialogue.nodes[id].y = y;
            }
            saveState();
        }
        isDragging = false;
        setTimeout(() => { hasDragged = false; }, 0);
        draggedElement = null;
    }
    
    function branchFromConnection(index, event) {
        const conn = characters[currentCharacterId].dialogue.connections[index];
        if (!conn) return;
        const canvasRect = editorCanvas.getBoundingClientRect();
        const x = event.clientX - canvasRect.left + 50, y = event.clientY - canvasRect.top + 50;
        const newNode = createNode("Interrupt", x, y, "Interrupt Dialogue");
        const dialogue = characters[currentCharacterId].dialogue;
        if (!dialogue.interruptions) dialogue.interruptions = [];
        dialogue.interruptions.push({ from: { fromNode: conn.from, toNode: conn.to }, to: newNode.id });
        saveState();
        updateLines();
    }
    
    function startEditingConnectionText(event, connectionIndex) {
        const textElement = event.target;
        const textRect = textElement.getBoundingClientRect();
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'inline-edit-input';
        input.value = textElement.textContent.trim();
        input.style.left = `${textRect.left}px`;
        input.style.top = `${textRect.top}px`;
        input.style.width = `${textRect.width + 20}px`;
        input.style.height = `${textRect.height}px`;
        document.body.appendChild(input);
        input.focus(); input.select();
        textElement.style.visibility = 'hidden';
        const cleanup = (save) => {
            if (save && characters[currentCharacterId].dialogue.connections[connectionIndex].text !== input.value) {
                characters[currentCharacterId].dialogue.connections[connectionIndex].text = input.value;
                saveState();
            } else {
                updateLines();
            }
            document.body.removeChild(input);
        };
        input.addEventListener('blur', () => cleanup(true));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') cleanup(true);
            if (e.key === 'Escape') cleanup(false);
        });
    }

    function deleteSelectedNodes() {
        if (selectedNodeIds.size === 0) return;
        const dialogue = characters[currentCharacterId].dialogue;
        selectedNodeIds.forEach(nodeId => {
            delete dialogue.nodes[nodeId];
            dialogue.connections = dialogue.connections.filter(conn => conn.from !== nodeId && conn.to !== nodeId);
            if (dialogue.interruptions) {
                dialogue.interruptions = dialogue.interruptions.filter(inter => 
                    inter.from.fromNode !== nodeId && inter.from.toNode !== nodeId && inter.to !== nodeId
                );
            }
        });
        saveState();
        renderDialogue(); 
    }
    
    function handleKeyPress(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.ctrlKey || e.metaKey) {
            if (e.key === 'z') { e.preventDefault(); undo(); }
            if (e.key === 'y' || (e.key === 'Z' && e.shiftKey)) { e.preventDefault(); redo(); }
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
            deleteSelectedNodes();
        }
    }
    
    function updateLines() {
        connectorLines.innerHTML = '';
        const dialogue = characters[currentCharacterId]?.dialogue;
        if (!dialogue) return;
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        defs.innerHTML = `<marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#555" /></marker>`;
        connectorLines.appendChild(defs);
        const connectionMidpoints = {};
        dialogue.connections.forEach((conn, index) => {
            const fromNodeEl = document.getElementById(conn.from);
            const toNodeEl = document.getElementById(conn.to);
            if (!fromNodeEl || !toNodeEl) return;
            const fromRect = fromNodeEl.getBoundingClientRect(), toRect = toNodeEl.getBoundingClientRect(), canvasRect = editorCanvas.getBoundingClientRect();
            const x1 = fromRect.left + fromRect.width / 2 - canvasRect.left, y1 = fromRect.top + fromRect.height / 2 - canvasRect.top, x2 = toRect.left + toRect.width / 2 - canvasRect.left, y2 = toRect.top + toRect.height / 2 - canvasRect.top;
            const midpointKey = `${conn.from}-${conn.to}`;
            connectionMidpoints[midpointKey] = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
            const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            const visibleLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            visibleLine.setAttribute('x1', x1); visibleLine.setAttribute('y1', y1); visibleLine.setAttribute('x2', x2); visibleLine.setAttribute('y2', y2);
            visibleLine.setAttribute('stroke', '#555'); visibleLine.setAttribute('stroke-width', '2');
            visibleLine.setAttribute('marker-end', 'url(#arrow)');
            const hitLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            hitLine.setAttribute('x1', x1); hitLine.setAttribute('y1', y1); hitLine.setAttribute('x2', x2); hitLine.setAttribute('y2', y2);
            hitLine.setAttribute('stroke', 'transparent'); hitLine.setAttribute('stroke-width', '15');
            hitLine.addEventListener('dblclick', (e) => branchFromConnection(index, e));
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', (x1 + x2) / 2); text.setAttribute('y', (y1 + y2) / 2 - 5);
            text.setAttribute('text-anchor', 'middle'); text.textContent = conn.text || " ";
            text.addEventListener('dblclick', (e) => startEditingConnectionText(e, index));
            group.appendChild(visibleLine); group.appendChild(hitLine); group.appendChild(text);
            connectorLines.appendChild(group);
        });
        if (dialogue.interruptions) {
            dialogue.interruptions.forEach(inter => {
                const midpointKey = `${inter.from.fromNode}-${inter.from.toNode}`;
                const midpoint = connectionMidpoints[midpointKey];
                const toNodeEl = document.getElementById(inter.to);
                if (!midpoint || !toNodeEl) return;
                const toRect = toNodeEl.getBoundingClientRect(), canvasRect = editorCanvas.getBoundingClientRect();
                const x1 = midpoint.x, y1 = midpoint.y;
                const x2 = toRect.left + toRect.width / 2 - canvasRect.left;
                const y2 = toRect.top + toRect.height / 2 - canvasRect.top;
                const interLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                interLine.setAttribute('x1', x1); interLine.setAttribute('y1', y1);
                interLine.setAttribute('x2', x2); interLine.setAttribute('y2', y2);
                interLine.setAttribute('stroke', '#333');
                interLine.setAttribute('stroke-width', '2');
                interLine.setAttribute('marker-end', 'url(#arrow)');
                connectorLines.appendChild(interLine);
            });
        }
    }

    function handleNodeClick(event, nodeId) { const el = document.getElementById(nodeId); const multi = event.ctrlKey || event.metaKey || event.shiftKey; if (!multi) deselectAllNodes(); if (selectedNodeIds.has(nodeId) && multi) { selectedNodeIds.delete(nodeId); el.classList.remove('selected'); } else if (!selectedNodeIds.has(nodeId)) { selectedNodeIds.add(nodeId); el.classList.add('selected'); } highlightPath(nodeId); }
    function deselectAllNodes() { selectedNodeIds.forEach(id => document.getElementById(id)?.classList.remove('selected')); selectedNodeIds.clear(); }
    function deselectAllCharacters() { selectedCharacterIds.forEach(id => document.getElementById(id)?.classList.remove('selected')); selectedCharacterIds.clear(); }
    function handleCharacterSelection(charId) { const el = document.getElementById(charId); if (selectedCharacterIds.has(charId)) { selectedCharacterIds.delete(charId); el.classList.remove('selected'); } else { selectedCharacterIds.add(charId); el.classList.add('selected'); } }
    function changeSelectedCharacterColors() { const newColor = characterColorPicker.value; selectedCharacterIds.forEach(id => { const char = characters[id]; if (char) { char.color = newColor; } }); saveState(); renderCharacters(); }
    function changeSelectedNodeColors() { const newColor = nodeColorPicker.value; selectedNodeIds.forEach(id => { const node = characters[currentCharacterId].dialogue.nodes[id]; if (node) { node.color = newColor; } }); saveState(); renderDialogue(); }
    function openPopup(id) { popupOverlay.classList.remove('hidden'); document.querySelectorAll('.popup-content').forEach(p=>p.classList.add('hidden')); document.getElementById(id).classList.remove('hidden'); }
    function closePopups() { popupOverlay.classList.add('hidden'); editingNodeId = null; editingCharacterId = null; if(connectingState) connectingState = null; }
    function showCharacterInfo(id) { editingCharacterId = id; const char = characters[id]; document.getElementById('edit-character-name').value = char.name; document.getElementById('edit-character-icon').value = char.icon; openPopup('edit-character-popup'); }
    function saveCharacterInfo() { if (!editingCharacterId) return; const char = characters[editingCharacterId]; char.name = document.getElementById('edit-character-name').value.trim()||"Char"; char.icon = document.getElementById('edit-character-icon').value.trim()||'👤'; saveState(); renderCharacters(); closePopups(); }
    function setupAndOpenRootNodePopup() { optionPopup.classList.add('root-mode'); document.getElementById('option-popup-title').textContent = 'Create Starting Point'; document.getElementById('dialogue-label').textContent = 'Starting Dialogue:'; saveOptionBtn.textContent = 'Create'; openPopup('option-popup'); }
    function setupAndOpenOptionPopup(nodeId) { if(connectingState){ selectedNodeIds.clear(); selectedNodeIds.add(connectingState.from); } else { selectedNodeIds.clear(); selectedNodeIds.add(nodeId); } optionPopup.classList.remove('root-mode'); document.getElementById('option-popup-title').textContent = 'Create Option'; document.getElementById('dialogue-label').textContent = 'Resulting Dialogue:'; saveOptionBtn.textContent = 'Save Option'; openPopup('option-popup'); }
    function showNodeInfo(nodeId) { editingNodeId = nodeId; const node = characters[currentCharacterId].dialogue.nodes[nodeId]; document.getElementById('edit-dialogue-textarea').value = node.fullText; document.getElementById('edit-notes-textarea').value = node.notes || ''; openPopup('node-info-popup'); }
    function saveNodeInfo() { if (!editingNodeId) return; const node = characters[currentCharacterId].dialogue.nodes[editingNodeId]; const newFullText = document.getElementById('edit-dialogue-textarea').value.trim(); if (newFullText) { node.fullText = newFullText; node.notes = document.getElementById('edit-notes-textarea').value.trim(); node.text = newFullText.split(' ')[0] || "Node"; saveState(); renderDialogue(); } closePopups(); }
    function createCharacter() { const name = document.getElementById('character-name-input').value.trim(); if (!name) return; const id = `char_${Date.now()}`; characters[id] = { id, name, icon: '👤', color: document.getElementById('character-color-input').value, x: 100, y: 100, dialogue: { nodes: {}, connections: [], interruptions: [] } }; document.getElementById('character-name-input').value = ''; saveState(); renderCharacters(); closePopups(); }
    function renderCharacters() { homeCanvas.innerHTML = ''; Object.values(characters).forEach(char => { const el = document.createElement('div'); el.id = char.id; el.className = 'character-node'; if (selectedCharacterIds.has(char.id)) el.classList.add('selected'); el.style.left = `${char.x}px`; el.style.top = `${char.y}px`; el.style.backgroundColor = char.color; el.style.color = getContrastColor(char.color); el.innerHTML = `<span class="edit-char-btn">✏️</span><div class="character-icon">${char.icon}</div><div>${char.name}</div>`; el.querySelector('.edit-char-btn').addEventListener('click', e => { e.stopPropagation(); showCharacterInfo(char.id); }); el.addEventListener('click', e => { if (hasDragged) return; if (e.ctrlKey || e.metaKey || e.shiftKey) { handleCharacterSelection(char.id); } else { openDialogueEditor(char.id); } }); homeCanvas.appendChild(el); }); }
    function openDialogueEditor(charId) { deselectAllCharacters(); currentCharacterId = charId; characterHeaderName.textContent = characters[charId].name; homePage.classList.add('hidden'); dialogueEditorPage.classList.remove('hidden'); addCharacterTool.classList.add('hidden'); characterColorTool.classList.add('hidden'); addNodeTool.classList.remove('hidden'); nodeColorTool.classList.remove('hidden'); renderDialogue(); }
    function showHomePage() { deselectAllNodes(); currentCharacterId = null; dialogueEditorPage.classList.add('hidden'); homePage.classList.remove('hidden'); addCharacterTool.classList.remove('hidden'); characterColorTool.classList.remove('hidden'); addNodeTool.classList.add('hidden'); nodeColorTool.classList.add('hidden'); }
    function renderDialogue() { editorCanvas.innerHTML = ''; editorCanvas.appendChild(connectorLines); const dialogue = characters[currentCharacterId]?.dialogue; if (dialogue && Object.keys(dialogue.nodes).length === 0) { createNode('Talk', 50, 50, 'Start of the conversation'); saveState(); } else if (dialogue) { Object.values(dialogue.nodes).forEach(createNodeElement); } updateLines(); }
    function createNode(text, x, y, fullText, notes = '') { const nodeId = `node_${Date.now()}`; const node = { id: nodeId, text, x, y, fullText, notes, color: nodeColorPicker.value }; if (characters[currentCharacterId]) { characters[currentCharacterId].dialogue.nodes[nodeId] = node; createNodeElement(node); } return node; }
    function createNodeElement(node) { const el = document.createElement('div'); el.id = node.id; el.className = 'dialogue-node'; el.style.left = `${node.x}px`; el.style.top = `${node.y}px`; el.style.backgroundColor = node.color; el.style.color = getContrastColor(node.color); el.innerHTML = `<div class="node-text">${node.text}</div><button class="create-option-btn">Create Option</button><div class="connection-handle"></div>`; el.addEventListener('dblclick', () => showNodeInfo(node.id)); el.querySelector('.create-option-btn').addEventListener('click', e => { e.stopPropagation(); setupAndOpenOptionPopup(node.id); }); el.addEventListener('click', e => { if (!hasDragged) handleNodeClick(e, node.id); }); editorCanvas.appendChild(el); }
    function saveOptionOrRootNode() { const resultingDialogue = document.getElementById('resulting-dialogue').value; const notes = document.getElementById('notes').value; const optionText = document.getElementById('option-text').value; if (!resultingDialogue) return; const dialogue = characters[currentCharacterId].dialogue; const firstWord = resultingDialogue.split(' ')[0] || "Node"; if (connectingState) { const { from, endX, endY } = connectingState; const newNode = createNode(firstWord, endX, endY, resultingDialogue, notes); dialogue.connections.push({ from, to: newNode.id, text: optionText }); connectingState = null; } else if (optionPopup.classList.contains('root-mode')) { createNode(firstWord, 100, 100, resultingDialogue, notes); } else { const fromNodeId = selectedNodeIds.values().next().value; if (!fromNodeId) return; const fromNode = dialogue.nodes[fromNodeId]; const newNode = createNode(firstWord, fromNode.x + 250, fromNode.y, resultingDialogue, notes); dialogue.connections.push({ from: fromNodeId, to: newNode.id, text: optionText }); } saveState(); updateLines(); closePopups(); document.getElementById('option-text').value = ''; document.getElementById('resulting-dialogue').value = ''; document.getElementById('notes').value = ''; }
    function highlightPath(leafNodeId) { document.querySelectorAll('.dialogue-node.path-highlight').forEach(n => n.classList.remove('path-highlight')); const dialogue = characters[currentCharacterId].dialogue; const predecessors = {}; dialogue.connections.forEach(conn => { predecessors[conn.to] = conn.from; }); let path = []; let currentNodeId = leafNodeId; while(currentNodeId) { path.push(currentNodeId); currentNodeId = predecessors[currentNodeId]; } path.forEach(nodeId => document.getElementById(nodeId)?.classList.add('path-highlight')); }
    
    // ----------------------------------------------------------------
    // INITIALIZATION
    // ----------------------------------------------------------------
    
    async function initializeApp() {
        // First, set up all the event listeners
        homeBtn.addEventListener('click', showHomePage);
        undoBtn.addEventListener('click', undo);
        redoBtn.addEventListener('click', redo);

        try {
            await initDB();
            const loadedCharacters = await loadData();
            if (loadedCharacters && Object.keys(loadedCharacters).length > 0) {
                characters = loadedCharacters;
                console.log("Loaded data from IndexedDB.");
            } else {
                console.log("No local data found, starting fresh.");
            }
        } catch (error) {
            console.error("Failed to load data from IndexedDB, starting fresh.", error);
        }
        
        renderCharacters(); // Render whatever is in 'characters' (loaded or empty)
        // Push the initial state (loaded or fresh) to the history for undo/redo
        const initialState = JSON.parse(JSON.stringify(characters));
        history.push(initialState);
        historyIndex = 0;
        updateUndoRedoButtons();
    }

    // Kick off the app
    initializeApp();
});